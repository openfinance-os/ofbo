import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  fils,
  parseNebrasTaxInvoice,
  reconcilePayable,
  type ExpectedTppCostStatement,
  type ParsedTppCostDocument
} from '../../billing/src/index.js'
import {
  applyMigrations,
  PgBillingMeteringStore,
  PgBillingTppCostStore,
  PgLineageEmitter
} from '../src/index.js'

/**
 * BILL-15 — payable reconciliation against a real database.
 *
 * The properties only a database can establish: a re-run of the same reconciliation does not double
 * the ledger, diff lines land under the CHECKed ten-value break taxonomy, the reconciliation_break_id
 * foreign key this story added actually refuses a dangling or cross-tenant reference, and an open
 * break is visible to the payable-approval gate. These tables are INSERT-only with no deletion path,
 * so a duplicate written here cannot be cleaned up afterwards.
 */

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const OTHER_TENANT = { bankId: '22222222-2222-4222-8222-222222222222', channel: 'internal_retail' }
const PERIOD = '2026-06'

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

describe('PgBillingTppCostStore — payable reconciliation', () => {
  const lineage = new PgLineageEmitter(DATABASE_URL!, TENANCY)
  const store = new PgBillingTppCostStore(DATABASE_URL!, TENANCY, lineage)
  const otherStore = new PgBillingTppCostStore(DATABASE_URL!, OTHER_TENANT, lineage)
  const metering = new PgBillingMeteringStore(DATABASE_URL!, TENANCY, lineage)
  const admin = new pg.Pool({ connectionString: DATABASE_URL })

  beforeAll(async () => { await applyMigrations(DATABASE_URL!) }, 60_000)
  afterAll(async () => {
    await store.close(); await otherStore.close(); await metering.close()
    await lineage.close(); await admin.end()
  })

  /** A statement + a document for the same period, which is the minimum a reconciliation needs. */
  async function seed(unitPriceFils = 2.5, netMilliFils = fils(2500)): Promise<{
    statementId: string
    documentId: string
    statement: ExpectedTppCostStatement
    parsed: ParsedTppCostDocument
    reference: string
  }> {
    const suffix = randomUUID()
    const run = await metering.saveMeterRun({
      period: PERIOD,
      rateCardVersion: '2026.06.02',
      inputHash: `sha256:${suffix}`,
      eventCount: 0,
      stats: {},
      evidence: {},
      lines: []
    }, `trace-${suffix}`)
    const statement = statementFor(run.run.id, netMilliFils)
    const saved = await store.saveStatement({ meterRunId: run.run.id, statement }, `trace-${suffix}`)

    const reference = `NEB-${suffix}`
    const parsed = parseNebrasTaxInvoice(invoiceBody(reference, unitPriceFils))
    const document = await store.saveDocument({
      document: parsed,
      documentSha256: `sha256:${'a'.repeat(64)}`,
      rawDocumentRef: `s3://retained/${reference}`,
      receivedAt: '2026-07-03T09:00:00.000Z',
      verifiedBy: 'finance.verifier',
      verifiedAt: '2026-07-03T09:05:00.000Z',
      idempotencyKey: randomUUID()
    }, `trace-${suffix}`)

    return { statementId: saved.record.id, documentId: document.record.id, statement, parsed, reference }
  }

  function reconcilable(seeded: Awaited<ReturnType<typeof seed>>) {
    return {
      documentId: seeded.documentId,
      documentType: seeded.parsed.documentType,
      issuerId: seeded.parsed.issuerId,
      documentReference: seeded.parsed.documentReference,
      billingPeriod: seeded.parsed.billingPeriod,
      issuedAt: seeded.parsed.issuedAt,
      receivedAt: '2026-07-03T09:00:00.000Z',
      lines: seeded.parsed.lines
    }
  }

  it('persists a clean reconciliation with no diff lines', async () => {
    const seeded = await seed()
    const result = reconcilePayable({ expected: seeded.statement, documents: [reconcilable(seeded)] })
    expect(result.breaks).toEqual([])

    const runId = `run-${randomUUID()}`
    const saved = await store.saveReconciliation({
      statementId: seeded.statementId, reconciliationRunId: runId, result
    }, 'trace-clean')

    expect(saved.created).toBe(true)
    const row = await admin.query(
      `SELECT billing_period, matched_line_count, break_count, net_variance_milli_fils,
              query_window_status, tolerance_milli_fils
         FROM billing_tpp_cost_reconciliation WHERE id = $1`, [saved.reconciliationIds[0]]
    )
    expect(row.rows[0]).toMatchObject({ billing_period: PERIOD, matched_line_count: 1, break_count: 0 })
    expect(Number(row.rows[0].net_variance_milli_fils)).toBe(0)
    expect(row.rows[0].query_window_status).toBe('open')
    expect(Number(row.rows[0].tolerance_milli_fils)).toBe(fils(1))
  })

  it('writes a rate variance as a diff line under the CHECKed break taxonomy', async () => {
    // The invoice bills 3 fils a unit against an expectation of 2.5.
    const seeded = await seed(3)
    const result = reconcilePayable({ expected: seeded.statement, documents: [reconcilable(seeded)] })
    expect(result.breaks).toHaveLength(1)

    const saved = await store.saveReconciliation({
      statementId: seeded.statementId, reconciliationRunId: `run-${randomUUID()}`, result
    }, 'trace-variance')

    const lines = await admin.query(
      `SELECT break_type, presence, expected_milli_fils, actual_milli_fils, variance_milli_fils,
              material, cost_recipient_type, fee_class, reconciliation_break_id
         FROM billing_tpp_cost_diff_line WHERE reconciliation_id = $1`, [saved.reconciliationIds[0]]
    )
    expect(lines.rows).toHaveLength(1)
    expect(lines.rows[0]).toMatchObject({
      break_type: 'rate_variance', presence: 'both', material: true,
      cost_recipient_type: 'nebras', fee_class: 'hub.standard'
    })
    expect(Number(lines.rows[0].expected_milli_fils)).toBe(fils(2500))
    expect(Number(lines.rows[0].actual_milli_fils)).toBe(fils(3000))
    expect(Number(lines.rows[0].variance_milli_fils)).toBe(fils(500))
    // No E1 break was linked on this path, and the column stays NULL rather than being invented.
    expect(lines.rows[0].reconciliation_break_id).toBeNull()
  })

  it('does not double-write the ledger when the same run is replayed', async () => {
    // INSERT-only with no deletion path: a duplicate written here cannot be removed afterwards.
    const seeded = await seed(3)
    const result = reconcilePayable({ expected: seeded.statement, documents: [reconcilable(seeded)] })
    const runId = `run-${randomUUID()}`

    const first = await store.saveReconciliation({
      statementId: seeded.statementId, reconciliationRunId: runId, result
    }, 'trace-1')
    const replay = await store.saveReconciliation({
      statementId: seeded.statementId, reconciliationRunId: runId, result
    }, 'trace-2')

    expect(first.created).toBe(true)
    expect(replay.created).toBe(false)
    expect(replay.reconciliationIds).toEqual(first.reconciliationIds)

    const count = await admin.query(
      `SELECT count(*)::int AS n FROM billing_tpp_cost_diff_line WHERE reconciliation_id = $1`,
      [first.reconciliationIds[0]]
    )
    expect(count.rows[0].n).toBe(1)
  })

  it('links a diff line to an E1 break, and REFUSES a dangling reference', async () => {
    // Criterion 6(b): the column BILL-13 left unconstrained now has a tenant-composite foreign key.
    const seeded = await seed(3)
    const result = reconcilePayable({ expected: seeded.statement, documents: [reconcilable(seeded)] })
    const breakId = randomUUID()
    await admin.query(
      `INSERT INTO reconciliation_break (id, bank_id, channel, run_id, line_type, source_a_ref, source_b_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [breakId, TENANCY.bankId, TENANCY.channel, 'run-e1', 'nebras_fees', 'own-metering', seeded.reference]
    )

    const linked = { ...result, breaks: result.breaks.map((b) => ({ ...b, reconciliationBreakId: breakId })) }
    const saved = await store.saveReconciliation({
      statementId: seeded.statementId, reconciliationRunId: `run-${randomUUID()}`, result: linked
    }, 'trace-linked')

    const row = await admin.query(
      `SELECT reconciliation_break_id FROM billing_tpp_cost_diff_line WHERE reconciliation_id = $1`,
      [saved.reconciliationIds[0]]
    )
    expect(row.rows[0].reconciliation_break_id).toBe(breakId)

    // A break id that does not exist is refused by the database, not merely by the service.
    const dangling = { ...result, breaks: result.breaks.map((b) => ({ ...b, reconciliationBreakId: randomUUID() })) }
    await expect(store.saveReconciliation({
      statementId: seeded.statementId, reconciliationRunId: `run-${randomUUID()}`, result: dangling
    }, 'trace-dangling')).rejects.toThrow(/foreign key|violates/i)
  })

  it('REFUSES to link a diff line to another tenant\'s break', async () => {
    // The composite key is what makes a cross-tenant reference unrepresentable rather than merely
    // filtered: RLS would hide the row, but without (bank_id, id) the FK would still resolve it.
    const seeded = await seed(3)
    const result = reconcilePayable({ expected: seeded.statement, documents: [reconcilable(seeded)] })
    const foreignBreakId = randomUUID()
    await admin.query(
      `INSERT INTO reconciliation_break (id, bank_id, channel, run_id, line_type, source_a_ref, source_b_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [foreignBreakId, OTHER_TENANT.bankId, OTHER_TENANT.channel, 'run-e1', 'nebras_fees', 'a', 'b']
    )

    const crossTenant = {
      ...result,
      breaks: result.breaks.map((b) => ({ ...b, reconciliationBreakId: foreignBreakId }))
    }
    await expect(store.saveReconciliation({
      statementId: seeded.statementId, reconciliationRunId: `run-${randomUUID()}`, result: crossTenant
    }, 'trace-cross')).rejects.toThrow(/foreign key|violates/i)
  })

  it('surfaces an unresolved break to the payable-approval gate, and a clean period as clear', async () => {
    // Criterion 3: a disputed line must not reach an approved payable. This is the query that gate
    // reads; BILL-16 enforces the refusal on top of it.
    const disputed = await seed(3)
    const disputedResult = reconcilePayable({
      expected: disputed.statement, documents: [reconcilable(disputed)]
    })
    await store.saveReconciliation({
      statementId: disputed.statementId, reconciliationRunId: `run-${randomUUID()}`, result: disputedResult
    }, 'trace-open')

    const open = await store.openPayableBreaks(PERIOD)
    expect(open.length).toBeGreaterThan(0)
    expect(open.some((entry) => entry.breakType === 'rate_variance')).toBe(true)

    // Another tenant sees none of it: the gate is tenant-scoped like everything else.
    expect(await otherStore.openPayableBreaks(PERIOD)).toEqual([])
  })

  it('keeps one reconciliation row per document so each links to the document it judged', async () => {
    // The table carries a single document_id with a foreign key, so a multi-document run cannot be one
    // row. They share a reconciliation_run_id instead, which is what makes the run reassemblable.
    const first = await seed()
    const second = await seed()
    const result = reconcilePayable({
      expected: first.statement,
      documents: [reconcilable(first), reconcilable(second)]
    })
    const runId = `run-${randomUUID()}`
    const saved = await store.saveReconciliation({
      statementId: first.statementId, reconciliationRunId: runId, result
    }, 'trace-multi')

    expect(saved.reconciliationIds).toHaveLength(2)
    const rows = await admin.query(
      `SELECT document_id FROM billing_tpp_cost_reconciliation WHERE reconciliation_run_id = $1`, [runId]
    )
    expect(rows.rows.map((r) => r.document_id).sort())
      .toEqual([first.documentId, second.documentId].sort())
  })
})
