import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  fils,
  parseNebrasTaxInvoice,
  reconcilePayable,
  type ExpectedTppCostStatement
} from '../../billing/src/index.js'
import {
  applyMigrations,
  PgBillingMeteringStore,
  PgBillingTppCostStore,
  PgLineageEmitter,
  PgPayableCloseStore,
  PgPayableDispatchStore,
  PgPayablePeriodStore
} from '../src/index.js'

/**
 * BILL-16 — the close and AP-dispatch write paths against a real database.
 *
 * These are the obligations migration 0039 explicitly pushed onto the write path because the schema
 * provably cannot carry them, and a mock cannot establish any of them:
 *
 *   (a) the cited approval must be `approved` and must have been approved INSIDE its window;
 *   (b) both principals must be stamped from the approval RECORD, normalised, never from input;
 *   (c) the P9 response must be redacted before the first INSERT;
 *   plus transition ORDER, which the UNIQUE constraint does not constrain, and tenant isolation.
 */

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const OTHER_TENANT = { bankId: '22222222-2222-4222-8222-222222222222', channel: 'internal_retail' }
const PERIOD = '2026-06'
const CLOSE_OP = 'billing.tpp_cost.period_close'

function statementFor(meterRunId: string, netMilliFils = fils(2500)): ExpectedTppCostStatement {
  const vat = Math.round(netMilliFils * 0.05)
  return {
    period: PERIOD,
    tenantId: TENANCY.bankId,
    currency: 'AED',
    rateCardVersion: '2026.06.02',
    evidence: {
      meterRunId,
      generatedAt: '2026-07-03T02:00:00.000Z',
      ratingRunAt: '2026-07-03T01:59:00.000Z',
      pricingEffectiveFrom: '2026-06-02',
      rateSnapshotHash: `sha256:${meterRunId}`,
      directorySnapshotId: null
    },
    lines: [{
      costRecipientType: 'nebras',
      costRecipientId: 'NEBRAS',
      feeStream: 'hub',
      feeClass: 'hub.standard',
      productFamily: 'payments',
      apiFamily: 'payments',
      customerSegment: 'unclassified',
      units: 1000,
      events: 1000,
      vatTreatment: 'exclusive',
      expectedNetMilliFils: netMilliFils,
      vatMilliFils: vat,
      expectedGrossMilliFils: netMilliFils + vat,
      eventIds: ['evt-1'],
      fapiInteractionIds: ['fapi-1']
    }],
    totals: {
      nebrasHubNetMilliFils: netMilliFils,
      underlyingLfiPaymentNetMilliFils: 0,
      underlyingLfiDataNetMilliFils: 0,
      totalNetMilliFils: netMilliFils,
      totalVatMilliFils: vat,
      totalGrossMilliFils: netMilliFils + vat
    }
  }
}

function invoiceBody(reference: string, unitPriceFils = 2.5) {
  return {
    invoice_number: reference,
    billing_period: PERIOD,
    currency: 'AED',
    issuer: { id: 'NEBRAS', trn: '100123456700003' },
    recipient: { id: 'bank-as-tpp', trn: '100987654300003' },
    issued_at: '2026-07-03T00:00:00.000Z',
    due_at: '2026-07-10T00:00:00.000Z',
    sections: [{
      name: 'Service Initiation',
      vat_treatment: 'exclusive',
      lines: [{ line_ref: 'SI-1', category: 'Payment Initiation', units: 1000, unit_price_fils: unitPriceFils }]
    }]
  }
}

describe('BILL-16 — payable close and AP dispatch', () => {
  const lineage = new PgLineageEmitter(DATABASE_URL!, TENANCY)
  const ledger = new PgBillingTppCostStore(DATABASE_URL!, TENANCY, lineage)
  const metering = new PgBillingMeteringStore(DATABASE_URL!, TENANCY, lineage)
  const closeStore = new PgPayableCloseStore(DATABASE_URL!, TENANCY, lineage)
  const dispatchStore = new PgPayableDispatchStore(DATABASE_URL!, TENANCY, lineage)
  const periodStore = new PgPayablePeriodStore(DATABASE_URL!, TENANCY, lineage)
  const otherCloseStore = new PgPayableCloseStore(DATABASE_URL!, OTHER_TENANT, lineage)
  const admin = new pg.Pool({ connectionString: DATABASE_URL })

  /**
   * Every period this suite closes. Closes are keyed by (bank_id, billing_period) — deliberately,
   * so one act cannot mint two records — which means fixed periods collide with the PREVIOUS RUN on
   * a database that persists between runs. CI gets a fresh Postgres each time and never notices; a
   * developer re-running locally would see ten spurious failures.
   */
  const OWNED_PERIODS = [
    PERIOD, '2026-04', '2026-02', '2026-03', '2026-01',
    '2025-12', '2025-11', '2025-10', '2025-09', '2025-08', '2025-07', '2025-06',
    '2025-05', '2025-04', '2025-03', '2025-02'
  ]

  beforeAll(async () => {
    await applyMigrations(DATABASE_URL!)
    // Cleared as the OWNER, which is the only role that can. `ofbo_app` holds SELECT + INSERT and
    // nothing else — the test below proves exactly that, so this fixture cannot be mistaken for a
    // deletion path the application has.
    await admin.query(
      `DELETE FROM billing_tpp_cost_ap_dispatch WHERE reconciliation_id IN (
         SELECT id FROM billing_tpp_cost_reconciliation WHERE billing_period = ANY($1))`,
      [OWNED_PERIODS]
    )
    await admin.query(
      `DELETE FROM billing_tpp_cost_period_close WHERE billing_period = ANY($1)`,
      [OWNED_PERIODS]
    )
  }, 60_000)
  afterAll(async () => {
    await ledger.close(); await metering.close(); await closeStore.close()
    await dispatchStore.close(); await periodStore.close(); await otherCloseStore.close()
    await lineage.close(); await admin.end()
  })

  /**
   * An approval in a stated state. The four-eyes CHECK compares recorded strings, so the two
   * principals differ here for the same reason they must differ in production.
   */
  async function seedApproval(options: {
    bankId?: string
    state?: string
    period?: string
    operationType?: string
    initiator?: string
    approver?: string | null
    approvedAt?: string | null
    expiresAt?: string
  } = {}): Promise<string> {
    const reference = `ar-${randomUUID()}`
    const client = await admin.connect()
    try {
      await client.query(
        `INSERT INTO approval_request
           (bank_id, channel, approval_request_id, operation_type, operation_payload, state, initiator,
            approver, approver_required_scope, expires_at, approved_at)
         VALUES ($1,'internal_retail',$2,$3,$4,$5,$6,$7,'finance:reconciliation:write',$8,$9)`,
        [
          options.bankId ?? TENANCY.bankId,
          reference,
          options.operationType ?? CLOSE_OP,
          JSON.stringify({ period: options.period ?? PERIOD }),
          options.state ?? 'approved',
          options.initiator ?? 'finance.analyst',
          options.approver === undefined ? 'finance.controller' : options.approver,
          options.expiresAt ?? new Date(Date.now() + 2 * 3600_000).toISOString(),
          options.approvedAt === undefined ? new Date().toISOString() : options.approvedAt
        ]
      )
    } finally {
      client.release()
    }
    return reference
  }

  /** A statement + document + reconciliation — the minimum a payable needs to exist. */
  async function seedPayable(): Promise<{ payableId: string; reference: string }> {
    const suffix = randomUUID()
    const run = await metering.saveMeterRun({
      period: PERIOD, rateCardVersion: '2026.06.02', inputHash: `sha256:${suffix}`,
      eventCount: 0, stats: {}, evidence: {}, lines: []
    }, `trace-${suffix}`)
    const statement = statementFor(run.run.id)
    const saved = await ledger.saveStatement({ meterRunId: run.run.id, statement }, `trace-${suffix}`)

    const reference = `NEB-${suffix}`
    const parsed = parseNebrasTaxInvoice(invoiceBody(reference))
    const document = await ledger.saveDocument({
      document: parsed,
      documentSha256: `sha256:${'a'.repeat(64)}`,
      rawDocumentRef: `s3://retained/${reference}`,
      receivedAt: '2026-07-03T09:00:00.000Z',
      verifiedBy: 'finance.verifier',
      verifiedAt: '2026-07-03T09:05:00.000Z',
      idempotencyKey: randomUUID()
    }, `trace-${suffix}`)

    const result = reconcilePayable({
      expected: statement,
      documents: [{
        documentId: document.record.id,
        documentType: parsed.documentType,
        issuerId: parsed.issuerId,
        documentReference: parsed.documentReference,
        billingPeriod: parsed.billingPeriod,
        issuedAt: parsed.issuedAt,
        receivedAt: '2026-07-03T09:00:00.000Z',
        lines: parsed.lines
      }]
    })
    const recon = await ledger.saveReconciliation({
      statementId: saved.record.id, reconciliationRunId: `run-${suffix}`, result
    }, `trace-${suffix}`)
    return { payableId: recon.reconciliationIds[0]!, reference }
  }

  // -------------------------------------------------------------------------------------------
  // The close
  // -------------------------------------------------------------------------------------------

  it('stamps BOTH principals from the approval RECORD, normalised (criterion 5(b))', async () => {
    // The CHECK can only prove two strings differ. What makes them two authenticated humans is that
    // they come from the approval, not from the caller — which is why the caller's own spelling is
    // deliberately different here and the STORED value follows the record.
    const approval = await seedApproval({ initiator: '  Finance.Analyst  ', approver: 'Finance.CONTROLLER' })
    const saved = await closeStore.saveClose({
      period: PERIOD,
      initiatedBy: 'FINANCE.analyst',
      approvedBy: '  finance.controller',
      approvalRequestId: approval,
      feedsMonthlySignOff: true
    }, 'trace-close-1')
    expect(saved.created).toBe(true)

    const row = (await admin.query(
      `SELECT initiated_by, approved_by, feeds_monthly_signoff FROM billing_tpp_cost_period_close WHERE id = $1`,
      [saved.closeId]
    )).rows[0]
    expect(row.initiated_by).toBe('finance.analyst')
    expect(row.approved_by).toBe('finance.controller')
    expect(row.feeds_monthly_signoff).toBe(true)
  })

  it('REFUSES a close whose named principals are not the ones who granted the approval', async () => {
    const approval = await seedApproval()
    await expect(closeStore.saveClose({
      period: PERIOD,
      initiatedBy: 'someone.else',
      approvedBy: 'finance.controller',
      approvalRequestId: approval,
      feedsMonthlySignOff: true
    }, 'trace-close-2')).rejects.toThrow(/not the ones who granted approval/)
  })

  it('REFUSES a close citing an approval that is not approved', async () => {
    const approval = await seedApproval({ state: 'pending', approver: null, approvedAt: null })
    await expect(closeStore.saveClose({
      period: PERIOD, initiatedBy: 'finance.analyst', approvedBy: 'finance.controller',
      approvalRequestId: approval, feedsMonthlySignOff: true
    }, 'trace-close-3')).rejects.toThrow(/is pending/)
  })

  it('a late approval cannot EXIST — the schema refuses it before any close can cite it', async () => {
    // State says THAT it was approved. Only approved_at says WHETHER it was approved in time, which
    // is the half migration 0042 exists to make checkable — and 0042 goes further than the write
    // path needs by CHECKing `approved_at <= expires_at` on the row itself.
    //
    // So this criterion is met at the strongest available level: a late approval is unrepresentable,
    // not merely rejected downstream. The store keeps its own comparison anyway, because the
    // obligation is stated as independent of any one enforcement point — but the only way to reach
    // it is a row this constraint would not admit, which is why the assertion is on the INSERT.
    const expiresAt = new Date(Date.now() - 3600_000).toISOString()
    await expect(seedApproval({ expiresAt, approvedAt: new Date().toISOString() }))
      .rejects.toThrow(/approval_request_approved_within_window/)
  })

  it('REFUSES an approved approval carrying no approved_at rather than assuming it was in time', async () => {
    const approval = await seedApproval({ approvedAt: null })
    await expect(closeStore.saveClose({
      period: PERIOD, initiatedBy: 'finance.analyst', approvedBy: 'finance.controller',
      approvalRequestId: approval, feedsMonthlySignOff: true
    }, 'trace-close-5')).rejects.toThrow(/carries no approved_at/)
  })

  it('REFUSES a close citing an approval granted for a different period', async () => {
    const approval = await seedApproval({ period: '2026-05' })
    await expect(closeStore.saveClose({
      period: PERIOD, initiatedBy: 'finance.analyst', approvedBy: 'finance.controller',
      approvalRequestId: approval, feedsMonthlySignOff: true
    }, 'trace-close-6')).rejects.toThrow(/covers 2026-05, not 2026-06/)
  })

  it('REFUSES a close citing an approval for a different operation', async () => {
    const approval = await seedApproval({ operationType: 'billing.invoice_run' })
    await expect(closeStore.saveClose({
      period: PERIOD, initiatedBy: 'finance.analyst', approvedBy: 'finance.controller',
      approvalRequestId: approval, feedsMonthlySignOff: true
    }, 'trace-close-7')).rejects.toThrow(/authorises billing.invoice_run/)
  })

  it('REFUSES an approval evidencing one person twice', async () => {
    const approval = await seedApproval({ initiator: 'one.person', approver: 'One.Person' })
    await expect(closeStore.saveClose({
      period: PERIOD, initiatedBy: 'one.person', approvedBy: 'one.person',
      approvalRequestId: approval, feedsMonthlySignOff: true
    }, 'trace-close-8')).rejects.toThrow(/one person twice/)
  })

  it('is idempotent on a retry, and REFUSES a divergent second close of the same period', async () => {
    const period = '2026-04'
    const approval = await seedApproval({ period })
    const first = await closeStore.saveClose({
      period, initiatedBy: 'finance.analyst', approvedBy: 'finance.controller',
      approvalRequestId: approval, feedsMonthlySignOff: true
    }, 'trace-close-9')
    expect(first.created).toBe(true)

    // Same act, retried — one row, not two. The family is INSERT-only, so a second row could never
    // be cleaned up.
    const replay = await closeStore.saveClose({
      period, initiatedBy: 'finance.analyst', approvedBy: 'finance.controller',
      approvalRequestId: approval, feedsMonthlySignOff: true
    }, 'trace-close-9')
    expect(replay.created).toBe(false)
    expect(replay.closeId).toBe(first.closeId)

    // A DIFFERENT four-eyes act on an already-closed period is refused, not silently ignored.
    const second = await seedApproval({ period, initiator: 'other.analyst', approver: 'other.controller' })
    await expect(closeStore.saveClose({
      period, initiatedBy: 'other.analyst', approvedBy: 'other.controller',
      approvalRequestId: second, feedsMonthlySignOff: true
    }, 'trace-close-9')).rejects.toThrow(/already closed under different four-eyes evidence/)

    const count = (await admin.query(
      `SELECT count(*)::int AS n FROM billing_tpp_cost_period_close WHERE billing_period = $1 AND bank_id = $2`,
      [period, TENANCY.bankId]
    )).rows[0].n
    expect(count).toBe(1)
  })

  it('cannot cite another tenant\'s approval', async () => {
    const foreign = await seedApproval({ bankId: OTHER_TENANT.bankId, period: '2026-03' })
    await expect(closeStore.saveClose({
      period: '2026-03', initiatedBy: 'finance.analyst', approvedBy: 'finance.controller',
      approvalRequestId: foreign, feedsMonthlySignOff: true
    }, 'trace-close-10')).rejects.toThrow()
  })

  it('emits BCBS 239 column lineage for the close (Q4.5)', async () => {
    const approval = await seedApproval({ period: '2026-02' })
    await closeStore.saveClose({
      period: '2026-02', initiatedBy: 'finance.analyst', approvedBy: 'finance.controller',
      approvalRequestId: approval, feedsMonthlySignOff: true
    }, 'trace-lineage-close')
    // BACKOFFICE-90 sibling — same `LIMIT 1`, no ORDER BY, no `source` filter, and the seed writes
    // a competing `seed-demo-scenario` row for this table too. Found by the sweep the item's own
    // acceptance criterion asks for, twelve assertions below the first instance.
    const row = (await admin.query(
      `SELECT columns FROM lineage_events
        WHERE table_name = 'billing_tpp_cost_period_close' AND source = 'billing-payable-store'
        ORDER BY id DESC LIMIT 1`
    )).rows[0]
    expect(row, 'no lineage row from the store under test').toBeDefined()
    expect(row.columns).toContain('approval_request_id')
    expect(row.columns).toContain('approved_by')
  })

  it('the close table is INSERT-only for ofbo_app', async () => {
    const client = await admin.connect()
    try {
      await client.query('SET ROLE ofbo_app')
      for (const statement of [
        `UPDATE billing_tpp_cost_period_close SET approved_by = 'x'`,
        `DELETE FROM billing_tpp_cost_period_close`
      ]) {
        await expect(client.query(statement)).rejects.toThrow(/permission denied/i)
      }
    } finally {
      await client.query('RESET ROLE').catch(() => undefined)
      client.release()
    }
  })

  // -------------------------------------------------------------------------------------------
  // The dispatch
  // -------------------------------------------------------------------------------------------

  it('reads a payable, and reports NO approval until the period closes', async () => {
    // Its own period, deliberately. The close tests above shut 2026-06, and a payable read against a
    // closed period would report the approval and prove nothing about the unclosed case.
    const { payableId } = await seedPayableForPeriod('2025-06')
    const before = await dispatchStore.approvedPayable(payableId)
    expect(before).not.toBeNull()
    expect(before!.period).toBe('2025-06')
    expect(before!.counterpartyType).toBe('nebras')
    // Authority to honour a debit belongs to the PERIOD. Until it closes there is none.
    expect(before!.approvalRequestId).toBeNull()
  })

  it('returns null for another tenant\'s payable rather than disclosing that it exists', async () => {
    const { payableId } = await seedPayable()
    const otherDispatch = new PgPayableDispatchStore(DATABASE_URL!, OTHER_TENANT, lineage)
    try {
      expect(await otherDispatch.approvedPayable(payableId)).toBeNull()
    } finally {
      await otherDispatch.close()
    }
  })

  it('records a dispatch, deriving every NOT NULL column the caller did not supply', async () => {
    const period = '2026-01'
    const { payableId } = await seedPayableForPeriod(period)
    const approval = await seedApproval({ period })
    await closeStore.saveClose({
      period, initiatedBy: 'finance.analyst', approvedBy: 'finance.controller',
      approvalRequestId: approval, feedsMonthlySignOff: true
    }, 'trace-d-0')

    const key = `idem-${randomUUID()}`
    const recorded = await dispatchStore.recordDispatch({
      payableId,
      dispatchRef: 'P9-REF-0001',
      status: 'dispatched',
      approvalRequestId: approval,
      idempotencyKey: key,
      responsePayload: { payable_status: 'dispatched', replayed: false, accepted: true }
    }, 'trace-d-1')
    expect(recorded.created).toBe(true)

    const row = (await admin.query(
      `SELECT initiated_by, approved_by, approved_at, dispatch_state, payable_net_milli_fils,
              statement_id, reconciliation_id, evidence_hash, response_payload
         FROM billing_tpp_cost_ap_dispatch WHERE id = $1`,
      [recorded.dispatchId]
    )).rows[0]
    // Both principals from the approval record, normalised (criterion 5(b)).
    expect(row.initiated_by).toBe('finance.analyst')
    expect(row.approved_by).toBe('finance.controller')
    expect(row.approved_at).toBeTruthy()
    expect(row.dispatch_state).toBe('dispatched')
    expect(Number(row.payable_net_milli_fils)).toBeGreaterThan(0)
    expect(row.statement_id).toBeTruthy()
    expect(row.reconciliation_id).toBe(payableId)
    expect(row.evidence_hash).toMatch(/^sha256:/)
  })

  it('REFUSES an unredacted P9 response before the first INSERT (criterion 5(c))', async () => {
    const period = '2025-12'
    const { payableId } = await seedPayableForPeriod(period)
    const approval = await seedApproval({ period })
    await closeStore.saveClose({
      period, initiatedBy: 'finance.analyst', approvedBy: 'finance.controller',
      approvalRequestId: approval, feedsMonthlySignOff: true
    }, 'trace-d-r0')

    await expect(dispatchStore.recordDispatch({
      payableId,
      dispatchRef: 'P9-REF-9999',
      status: 'dispatched',
      approvalRequestId: approval,
      idempotencyKey: `idem-${randomUUID()}`,
      // A synthetic UAE IBAN in the unallocated bank code 000 — the shape the redactor recognises.
      // The row is INSERT-only with no deletion path, so this must never become permanent.
      responsePayload: { payable_status: 'dispatched', debtor_account: 'AE070000000000000001234' }
    }, 'trace-d-r1')).rejects.toThrow(/unredacted financial-system response/)

    const written = (await admin.query(
      `SELECT count(*)::int AS n FROM billing_tpp_cost_ap_dispatch WHERE approval_request_id = $1`,
      [approval]
    )).rows[0].n
    expect(written).toBe(0)
  })

  it('REFUSES an illegal transition — accepted cannot follow rejected', async () => {
    // The UNIQUE constraint bounds each state to one row per instruction, but 0039 is explicit that
    // it "constrains no transition ORDER". That is this write path's job.
    const period = '2025-11'
    const { payableId } = await seedPayableForPeriod(period)
    const approval = await seedApproval({ period })
    await closeStore.saveClose({
      period, initiatedBy: 'finance.analyst', approvedBy: 'finance.controller',
      approvalRequestId: approval, feedsMonthlySignOff: true
    }, 'trace-d-t0')

    const key = `idem-${randomUUID()}`
    await dispatchStore.recordDispatch({
      payableId, dispatchRef: 'P9-T-1', status: 'dispatched',
      approvalRequestId: approval, idempotencyKey: key
    }, 'trace-d-t1')
    await dispatchStore.recordDispatch({
      payableId, dispatchRef: 'P9-T-1', status: 'rejected',
      approvalRequestId: approval, idempotencyKey: key
    }, 'trace-d-t2')

    await expect(dispatchStore.recordDispatch({
      payableId, dispatchRef: 'P9-T-1', status: 'collected',
      approvalRequestId: approval, idempotencyKey: key
    }, 'trace-d-t3')).rejects.toThrow(/rejected is terminal/)
  })

  it('is idempotent on a retry of the same state', async () => {
    const period = '2025-10'
    const { payableId } = await seedPayableForPeriod(period)
    const approval = await seedApproval({ period })
    await closeStore.saveClose({
      period, initiatedBy: 'finance.analyst', approvedBy: 'finance.controller',
      approvalRequestId: approval, feedsMonthlySignOff: true
    }, 'trace-d-i0')

    const key = `idem-${randomUUID()}`
    const first = await dispatchStore.recordDispatch({
      payableId, dispatchRef: 'P9-I-1', status: 'dispatched',
      approvalRequestId: approval, idempotencyKey: key
    }, 'trace-d-i1')
    const replay = await dispatchStore.recordDispatch({
      payableId, dispatchRef: 'P9-I-1', status: 'mandate_active',
      approvalRequestId: approval, idempotencyKey: key
    }, 'trace-d-i2')

    // `mandate_active` maps onto the SAME ledger state as `dispatched` — what the constraint bounds
    // is one dispatch per instruction, not the debit's progress through the collection window.
    expect(replay.created).toBe(false)
    expect(replay.dispatchId).toBe(first.dispatchId)
  })

  it('progresses dispatched -> accepted by APPENDING a row, never by UPDATE', async () => {
    const period = '2025-09'
    const { payableId } = await seedPayableForPeriod(period)
    const approval = await seedApproval({ period })
    await closeStore.saveClose({
      period, initiatedBy: 'finance.analyst', approvedBy: 'finance.controller',
      approvalRequestId: approval, feedsMonthlySignOff: true
    }, 'trace-d-p0')

    const key = `idem-${randomUUID()}`
    await dispatchStore.recordDispatch({
      payableId, dispatchRef: 'P9-P-1', status: 'dispatched',
      approvalRequestId: approval, idempotencyKey: key
    }, 'trace-d-p1')
    await dispatchStore.recordDispatch({
      payableId, dispatchRef: 'P9-P-1', status: 'collected',
      approvalRequestId: approval, idempotencyKey: key
    }, 'trace-d-p2')

    const states = (await admin.query(
      `SELECT dispatch_state FROM billing_tpp_cost_ap_dispatch
        WHERE idempotency_key = $1 ORDER BY created_at ASC`,
      [key]
    )).rows.map((r) => r.dispatch_state)
    expect(states).toEqual(['dispatched', 'accepted'])
  })

  /**
   * BACKOFFICE-90 — scoped to the emitter under test, with a deterministic order.
   *
   * This read `LIMIT 1` with no `ORDER BY` and no `source` filter, over a table that holds
   * THIRTEEN rows for `billing_tpp_cost_ap_dispatch` after `db:seed`: twelve from
   * `billing-payable-store` (the emitter under test, carrying `response_payload`) and one from
   * `seed-demo-scenario` with six columns and no `response_payload`. Which one came back was
   * physical heap order.
   *
   * Both outcomes were wrong. It failed when the seed row surfaced first, and when it passed it
   * might have been reading a row the store never wrote — a Q4.5 lineage gate satisfiable by the
   * seed is not a gate. Asserting the emitter's own row is strictly stronger than what was here.
   *
   * The `source` filter is what makes this deterministic, NOT the ORDER BY: `lineage_events.id` is
   * a `gen_random_uuid()`, so ordering by it does not select the latest row. It is retained only to
   * pin ONE row rather than an arbitrary one; every candidate the filter admits is emitted from a
   * single site with a constant column list, so they are interchangeable. Saying this because the
   * first version of this comment claimed a determinism the ordering does not provide.
   */
  it('emits BCBS 239 column lineage for AP dispatch (Q4.5)', async () => {
    const row = (await admin.query(
      `SELECT columns FROM lineage_events
        WHERE table_name = 'billing_tpp_cost_ap_dispatch' AND source = 'billing-payable-store'
        ORDER BY id DESC LIMIT 1`
    )).rows[0]
    expect(row, 'no lineage row from the store under test').toBeDefined()
    expect(row.columns).toContain('response_payload')
    expect(row.columns).toContain('dispatch_state')
  })

  // -------------------------------------------------------------------------------------------
  // The period read model
  // -------------------------------------------------------------------------------------------

  it('reports the period with its close, its payables and its latest dispatch state', async () => {
    const period = '2025-08'
    const { payableId } = await seedPayableForPeriod(period)
    const approval = await seedApproval({ period })
    await closeStore.saveClose({
      period, initiatedBy: 'finance.analyst', approvedBy: 'finance.controller',
      approvalRequestId: approval, feedsMonthlySignOff: true
    }, 'trace-pr-0')
    await dispatchStore.recordDispatch({
      payableId, dispatchRef: 'P9-PR-1', status: 'dispatched',
      approvalRequestId: approval, idempotencyKey: `idem-${randomUUID()}`
    }, 'trace-pr-1')

    const close = await periodStore.periodClose(period)
    expect(close).not.toBeNull()
    expect(close!.approvalRequestId).toBe(approval)
    expect(close!.approvedBy).toBe('finance.controller')

    const payables = await periodStore.payablesForPeriod(period)
    const mine = payables.find((p) => p.payableId === payableId)!
    expect(mine).toBeDefined()
    expect(mine.costRecipientType).toBe('nebras')
    expect(mine.dispatchState).toBe('dispatched')
    expect(mine.grossMilliFils).toBeGreaterThan(0)
  })

  it('does not leak another tenant\'s close', async () => {
    const period = '2025-07'
    const approval = await seedApproval({ period })
    await closeStore.saveClose({
      period, initiatedBy: 'finance.analyst', approvedBy: 'finance.controller',
      approvalRequestId: approval, feedsMonthlySignOff: true
    }, 'trace-rls-1')

    const otherPeriod = new PgPayablePeriodStore(DATABASE_URL!, OTHER_TENANT, lineage)
    try {
      expect(await otherPeriod.periodClose(period)).toBeNull()
    } finally {
      await otherPeriod.close()
    }
  })

  it('BILL-17: the pack never publishes raw_document_ref, the locator for unredacted originals', async () => {
    // The archive behind that column holds UNREDACTED provider content by design
    // (services/bff/src/billing/tpp-cost-document.ts:253-268) and is deliberately not one of the
    // cost tables for that reason. Publishing its address in a downloadable file would hand out the
    // route to the original — the evidence of what was charged is the parsed lines, not the scan.
    const period = '2026-08'
    await seedPayableForPeriod(period)

    const pack = await periodStore.evidencePack(period)
    expect(pack.documents.length).toBeGreaterThan(0)
    for (const document of pack.documents) {
      expect(Object.keys(document as Record<string, unknown>)).not.toContain('raw_document_ref')
    }
    // Asserted on the serialised artefact too, which is what a human actually receives — a nested
    // copy under some other key would pass the key check above.
    expect(JSON.stringify(pack)).not.toContain('raw_document_ref')
    expect(JSON.stringify(pack)).not.toContain('s3://')
  })

  it('BILL-17: the evidence pack is one consistent snapshot, scoped to the caller\'s own tenant', async () => {
    // A period no other test in this file touches: closes are UNIQUE per (bank, period), so a
    // shared one makes this test's outcome depend on execution order.
    const period = '2026-07'
    const { payableId } = await seedPayableForPeriod(period)
    const approval = await seedApproval({ period })
    await closeStore.saveClose({
      period, initiatedBy: 'finance.analyst', approvedBy: 'finance.controller',
      approvalRequestId: approval, feedsMonthlySignOff: true
    }, 'trace-pack-1')
    await dispatchStore.recordDispatch({
      payableId,
      dispatchRef: 'P9-REF-2025-09',
      status: 'dispatched',
      approvalRequestId: approval,
      idempotencyKey: 'idem-pack-1',
      responsePayload: { payable_status: 'dispatched', replayed: false }
    }, 'trace-pack-2')

    const pack = await periodStore.evidencePack(period)
    expect(pack.closes).toHaveLength(1)
    expect(pack.dispatches).toHaveLength(1)
    expect(pack.reconciliations.length).toBeGreaterThan(0)
    // Documents carry their parsed lines nested, so a reader never has to rejoin two collections
    // to see what a document actually said.
    expect(pack.documents.length).toBeGreaterThan(0)
    expect(Array.isArray((pack.documents[0] as { lines?: unknown }).lines)).toBe(true)

    // RLS, not a WHERE clause, is what keeps another tenant out. Proven by asking as one.
    const otherPeriod = new PgPayablePeriodStore(DATABASE_URL!, OTHER_TENANT, lineage)
    try {
      const foreign = await otherPeriod.evidencePack(period)
      expect(foreign.closes).toHaveLength(0)
      expect(foreign.dispatches).toHaveLength(0)
      expect(foreign.documents).toHaveLength(0)
      expect(foreign.reconciliations).toHaveLength(0)
      expect(foreign.diffLines).toHaveLength(0)
    } finally {
      await otherPeriod.close()
    }
  })

  it('REFUSES a financial_system_ref that is not reference-shaped (the grant\'s real basis)', async () => {
    // The gap the cross-tenant grant actually turns on. `redactText` masks three SHAPES — Emirates
    // ID, IBAN, e-mail — and passes everything else through, so a vendor reference carrying a
    // personal name matches nothing and would survive into a column with no deletion path. Shape
    // constraint is the only check that is total for free text.
    const period = '2025-05'
    const { payableId } = await seedPayableForPeriod(period)
    const approval = await seedApproval({ period })
    await closeStore.saveClose({
      period, initiatedBy: 'finance.analyst', approvedBy: 'finance.controller',
      approvalRequestId: approval, feedsMonthlySignOff: true
    }, 'trace-ref-0')

    await expect(dispatchStore.recordDispatch({
      payableId,
      // Prose a masking redactor recognises nothing in. No identifier shape, no PSU key.
      dispatchRef: 'DD/2026-07/NEBRAS - mandate held by A. Rahman, acct ending 4412',
      status: 'dispatched',
      approvalRequestId: approval,
      idempotencyKey: `idem-${randomUUID()}`
    }, 'trace-ref-1')).rejects.toThrow(/not reference-shaped/)

    const written = (await admin.query(
      `SELECT count(*)::int AS n FROM billing_tpp_cost_ap_dispatch WHERE approval_request_id = $1`,
      [approval]
    )).rows[0].n
    expect(written).toBe(0)
  })

  it('admits an opaque vendor reference, and the masking markers the service may substitute', async () => {
    // The constraint must not reject legitimate references, or it would be a denial of service on
    // correct data — the same failure BILL-14 hit when a generic digit rule ate the required TRNs.
    const period = '2025-04'
    const { payableId } = await seedPayableForPeriod(period)
    const approval = await seedApproval({ period })
    await closeStore.saveClose({
      period, initiatedBy: 'finance.analyst', approvedBy: 'finance.controller',
      approvalRequestId: approval, feedsMonthlySignOff: true
    }, 'trace-ref-ok-0')

    for (const ref of ['P9-DD-2026-07/NEBRAS:0042', 'urn:p9:dispatch:9f3c=', '[REDACTED:iban]']) {
      await expect(dispatchStore.recordDispatch({
        payableId, dispatchRef: ref, status: 'dispatched',
        approvalRequestId: approval, idempotencyKey: `idem-${randomUUID()}`
      }, 'trace-ref-ok-1')).resolves.toMatchObject({ created: true })
    }
  })

  it('PERSISTS no customer detail in either provider-fed column — read back from the row', async () => {
    // 0040 set the bar as redaction "proven by a test against a persisted row". A refusal test
    // proves the guard fires; this proves what actually LANDS, which is the claim migration 0043
    // makes when it grants the cross-tenant read.
    const period = '2025-03'
    const { payableId } = await seedPayableForPeriod(period)
    const approval = await seedApproval({ period })
    await closeStore.saveClose({
      period, initiatedBy: 'finance.analyst', approvedBy: 'finance.controller',
      approvalRequestId: approval, feedsMonthlySignOff: true
    }, 'trace-persist-0')

    const key = `idem-${randomUUID()}`
    const recorded = await dispatchStore.recordDispatch({
      payableId,
      dispatchRef: 'P9-DD-2025-03-0001',
      status: 'dispatched',
      approvalRequestId: approval,
      idempotencyKey: key,
      responsePayload: { payable_status: 'dispatched', replayed: false, accepted: true }
    }, 'trace-persist-1')

    const row = (await admin.query(
      `SELECT financial_system_ref, response_payload::text AS payload, idempotency_key
         FROM billing_tpp_cost_ap_dispatch WHERE id = $1`,
      [recorded.dispatchId]
    )).rows[0]

    const stored = `${row.financial_system_ref} ${row.payload} ${row.idempotency_key}`
    // No UAE IBAN, no Emirates-ID shape, no e-mail, anywhere in what was actually written.
    expect(stored).not.toMatch(/AE\d{2}(?:[ ._-]?\d){19}/i)
    expect(stored).not.toMatch(/\b\d{3}[-._ ]?\d{4}[-._ ]?\d{7}[-._ ]?\d\b/)
    expect(stored).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)
    // And the reference itself is opaque, not prose.
    expect(row.financial_system_ref).toMatch(/^[A-Za-z0-9._:/=+-]{1,128}$/)
  })

  it('reports an already-closed period so the request path can refuse it', async () => {
    const period = '2025-02'
    const approval = await seedApproval({ period })
    expect(await closeStore.closeForPeriod(period)).toBeNull()
    await closeStore.saveClose({
      period, initiatedBy: 'finance.analyst', approvedBy: 'finance.controller',
      approvalRequestId: approval, feedsMonthlySignOff: true
    }, 'trace-cfp-1')
    const existing = await closeStore.closeForPeriod(period)
    expect(existing?.approvalRequestId).toBe(approval)
    expect(existing?.closedAt).toBeTruthy()
  })

  /** Same as seedPayable, but for a nominated period so each test owns its own close. */
  async function seedPayableForPeriod(period: string): Promise<{ payableId: string }> {
    const suffix = randomUUID()
    const run = await metering.saveMeterRun({
      period, rateCardVersion: '2026.06.02', inputHash: `sha256:${suffix}`,
      eventCount: 0, stats: {}, evidence: {}, lines: []
    }, `trace-${suffix}`)
    const statement = { ...statementFor(run.run.id), period }
    const saved = await ledger.saveStatement({ meterRunId: run.run.id, statement }, `trace-${suffix}`)

    const reference = `NEB-${suffix}`
    const parsed = parseNebrasTaxInvoice({ ...invoiceBody(reference), billing_period: period })
    const document = await ledger.saveDocument({
      document: parsed,
      documentSha256: `sha256:${'a'.repeat(64)}`,
      rawDocumentRef: `s3://retained/${reference}`,
      receivedAt: '2026-07-03T09:00:00.000Z',
      verifiedBy: 'finance.verifier',
      verifiedAt: '2026-07-03T09:05:00.000Z',
      idempotencyKey: randomUUID()
    }, `trace-${suffix}`)

    const result = reconcilePayable({
      expected: statement,
      documents: [{
        documentId: document.record.id,
        documentType: parsed.documentType,
        issuerId: parsed.issuerId,
        documentReference: parsed.documentReference,
        billingPeriod: parsed.billingPeriod,
        issuedAt: parsed.issuedAt,
        receivedAt: '2026-07-03T09:00:00.000Z',
        lines: parsed.lines
      }]
    })
    const recon = await ledger.saveReconciliation({
      statementId: saved.record.id, reconciliationRunId: `run-${suffix}`, result
    }, `trace-${suffix}`)
    return { payableId: recon.reconciliationIds[0]! }
  }
})
