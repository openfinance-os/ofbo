import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  SCHEME_RATE_CARD_2026_06_02,
  buildExpectedTppCostStatement,
  canonicalBillingCloudEvent,
  fils,
  meterBillableEvents,
  parseBillingCloudEvent,
  rateUsage,
  type DirectoryOverageSnapshot,
  type ExpectedTppCostEvidence,
  type ExpectedTppCostStatement
} from '../../billing/src/index.js'
import {
  applyMigrations,
  PgBillingMeteringStore,
  PgBillingTppCostStore,
  PgLineageEmitter,
  PgTenantBillingServiceStore
} from '../src/index.js'

/**
 * BILL-13 — the durable payable ledger.
 *
 * Proves the properties that make it a regulated ledger rather than a table: tenant isolation,
 * INSERT-only immutability, zero PSU data, and closed-period correction by delta rather than
 * mutation. These cannot be established by unit tests — they are database controls.
 */

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const OTHER_TENANT = { bankId: '22222222-2222-4222-8222-222222222222', channel: 'internal_retail' }

const COST_TABLES = [
  'billing_tpp_cost_statement',
  'billing_tpp_cost_statement_line',
  'billing_tpp_cost_document',
  'billing_tpp_cost_document_line',
  'billing_tpp_cost_reconciliation',
  'billing_tpp_cost_diff_line',
  'billing_tpp_cost_ap_dispatch',
  'billing_tpp_cost_rerating'
]

function snapshot(rateMilliFils: number, id: string): DirectoryOverageSnapshot {
  return {
    snapshotId: id,
    retrievedAt: '2026-06-01T00:00:00.000Z',
    sourceUrl: 'https://data.directory.openfinance.ae/participants',
    digest: `sha256:${id}`,
    currency: 'AED',
    unit: 'per_page',
    rates: [{ lfiId: 'lfi-alpha', rateMilliFils, effectiveFrom: '2026-01-01' }]
  }
}

/** One outbound payment and one overage-bearing data call: a Hub cost and two LFI costs. */
function outboundEvents(suffix: string) {
  const base = {
    outcome: 200,
    direction: 'outbound' as const,
    tppId: `bank-as-tpp-${suffix}`,
    clientId: 'client-a',
    counterpartyLfiId: 'lfi-alpha',
    psuId: `psu-${suffix}`
  }
  const event = (id: string, extra: Record<string, unknown>) => parseBillingCloudEvent({
    specversion: '1.0',
    id: `${id}-${suffix}`,
    source: 'urn:ofbo:gateway',
    type: 'com.ofbo.billing.gateway-call.v1',
    subject: `${id}-${suffix}`,
    time: '2026-06-15T10:00:00Z',
    datacontenttype: 'application/json',
    fapiinteractionid: `fapi-${id}-${suffix}`,
    data: { ...base, ...extra }
  })
  return [
    event('pay', { endpoint: 'POST /payments', payment: { type: 'p2p_sme', amountMilliFils: fils(10_000) } }),
    event('data', { endpoint: 'GET /accounts/{id}/transactions', data: { segment: 'retail', attended: true, lines: 1_800 } })
  ]
}

describe('PgBillingTppCostStore', () => {
  const lineage = new PgLineageEmitter(DATABASE_URL!, TENANCY)
  const metering = new PgBillingMeteringStore(DATABASE_URL!, TENANCY, lineage)
  const store = new PgBillingTppCostStore(DATABASE_URL!, TENANCY, lineage)
  const otherStore = new PgBillingTppCostStore(DATABASE_URL!, OTHER_TENANT, lineage)
  const admin = new pg.Pool({ connectionString: DATABASE_URL })

  beforeAll(async () => {
    await applyMigrations(DATABASE_URL!)
  }, 60_000)

  afterAll(async () => {
    await store.close()
    await otherStore.close()
    await metering.close()
    await lineage.close()
    await admin.end()
  })

  /** Meter and rate a fresh period, then project it into a statement. */
  async function persistStatement(overageMilliFils: number, snapshotId: string): Promise<{
    statementId: string
    meterRunId: string
    statement: ExpectedTppCostStatement
    created: boolean
  }> {
    const suffix = randomUUID()
    const events = outboundEvents(suffix)
    const trace = `trace-${suffix}`
    await metering.ingestEvents(events.map((event) => ({
      eventId: event.id,
      source: event.source,
      type: event.type,
      occurredAt: event.time,
      eventHash: `sha256:${canonicalBillingCloudEvent(event)}`,
      eventPayload: event,
      fapiInteractionId: event.fapiinteractionid,
      endpoint: event.data.endpoint,
      outcome: event.data.outcome,
      direction: event.data.direction,
      tppId: event.data.tppId,
      psuId: event.data.psuId
    })), trace)

    const metered = meterBillableEvents(events, SCHEME_RATE_CARD_2026_06_02)
    const run = await metering.saveMeterRun({
      period: '2026-06',
      rateCardVersion: SCHEME_RATE_CARD_2026_06_02.version,
      inputHash: `sha256:${suffix}`,
      eventCount: metered.stats.eventsTotal,
      stats: metered.stats,
      evidence: metered.evidence,
      lines: metered.lines
    }, trace)

    const rating = rateUsage(metered.lines, SCHEME_RATE_CARD_2026_06_02, '2026-06', [], {
      overageSnapshot: snapshot(overageMilliFils, snapshotId)
    })
    const evidence: ExpectedTppCostEvidence = {
      tenantId: TENANCY.bankId,
      meterRunId: run.run.id,
      generatedAt: '2026-07-03T02:00:00.000Z',
      ratingRunAt: '2026-07-03T01:59:00.000Z',
      pricingEffectiveFrom: SCHEME_RATE_CARD_2026_06_02.effectiveFrom,
      rateSnapshotHash: `sha256:pricing+${snapshotId}`,
      directorySnapshotId: snapshotId
    }
    const statement = buildExpectedTppCostStatement(rating, evidence)
    const saved = await store.saveStatement({ meterRunId: run.run.id, statement }, trace)
    return { statementId: saved.record.id, meterRunId: run.run.id, statement, created: saved.created }
  }

  it('persists an expected cost statement with its lines and reads it back intact', async () => {
    const { statementId, statement } = await persistStatement(fils(800), `dir-${randomUUID()}`)

    const stored = await store.statementById(statementId)
    expect(stored?.statement.totals).toEqual(statement.totals)
    expect(stored?.statement.currency).toBe('AED')

    const lines = await store.statementLines(statementId)
    expect(lines.length).toBe(statement.lines.length)
    expect(lines.length).toBeGreaterThan(0)
    // The three streams must still add up once round-tripped through the ledger.
    const net = lines.reduce((sum, line) => sum + line.expectedNetMilliFils, 0)
    expect(net).toBe(statement.totals.totalNetMilliFils)
    expect(lines.every((line) => line.eventIds.length > 0)).toBe(true)
  })

  it('is idempotent: the same run and rate snapshot yields one statement, not a second', async () => {
    const snapshotId = `dir-${randomUUID()}`
    const first = await persistStatement(fils(800), snapshotId)
    expect(first.created).toBe(true)

    const again = await store.saveStatement(
      { meterRunId: first.meterRunId, statement: first.statement },
      'trace-replay'
    )
    expect(again.created).toBe(false)
    expect(again.record.id).toBe(first.statementId)

    const count = await admin.query(
      `SELECT count(*)::int AS n FROM billing_tpp_cost_statement WHERE meter_run_id = $1`,
      [first.meterRunId]
    )
    expect(count.rows[0].n).toBe(1)
  })

  it('is idempotent across a RESUMED run, whose clock has moved on since the first attempt', async () => {
    // The monthly worker stamps generatedAt/ratingRunAt from its own run clock, and scheduled jobs
    // in this repo must be resumable (CLAUDE.md, demo profile). So the realistic replay is not the
    // identical object — it is the same statement re-derived later. Comparing the full evidence hash
    // would call that divergence and fail the whole billing projection.
    const snapshotId = `dir-${randomUUID()}`
    const first = await persistStatement(fils(800), snapshotId)
    expect(first.created).toBe(true)

    const resumed: ExpectedTppCostStatement = {
      ...first.statement,
      evidence: {
        ...first.statement.evidence,
        generatedAt: '2026-07-04T06:30:00.000Z',
        ratingRunAt: '2026-07-04T06:29:00.000Z'
      }
    }
    const again = await store.saveStatement({ meterRunId: first.meterRunId, statement: resumed }, 'trace-resumed')

    expect(again.created).toBe(false)
    expect(again.record.id).toBe(first.statementId)
    // Still one statement, and the FIRST write's timestamps are what the ledger records.
    const row = await admin.query(
      `SELECT count(*)::int AS n, min(generated_at) AS generated FROM billing_tpp_cost_statement
        WHERE meter_run_id = $1`,
      [first.meterRunId]
    )
    expect(row.rows[0].n).toBe(1)
    expect(new Date(row.rows[0].generated as string).toISOString()).toBe('2026-07-03T02:00:00.000Z')
  })

  it('never persists a PSU identifier anywhere in the cost ledger', async () => {
    const { statementId, statement } = await persistStatement(fils(800), `dir-${randomUUID()}`)

    // The metered events carried a psuId; the statement and its lines must not.
    const dump = await admin.query(
      `SELECT to_jsonb(s) AS s FROM billing_tpp_cost_statement s WHERE id = $1`,
      [statementId]
    )
    const lineDump = await admin.query(
      `SELECT to_jsonb(l) AS l FROM billing_tpp_cost_statement_line l WHERE statement_id = $1`,
      [statementId]
    )
    const serialised = JSON.stringify(dump.rows[0].s) + JSON.stringify(lineDump.rows.map((r) => r.l))
    expect(serialised).not.toMatch(/psu/i)
    expect(statement.lines.length).toBeGreaterThan(0)
  })

  it('isolates tenants: another bank cannot see or read this statement', async () => {
    const { statementId } = await persistStatement(fils(800), `dir-${randomUUID()}`)

    expect(await otherStore.statementById(statementId)).toBeNull()
    expect(await otherStore.statementLines(statementId)).toEqual([])
  })

  it('refuses UPDATE and DELETE on every cost table for the application role', async () => {
    const client = await admin.connect()
    try {
      await client.query('BEGIN')
      await client.query('SET LOCAL ROLE ofbo_app')
      for (const table of COST_TABLES) {
        await expect(
          client.query(`UPDATE ${table} SET classification = classification`),
          `${table} must not be updatable`
        ).rejects.toThrow(/permission denied/i)
        await client.query('ROLLBACK')
        await client.query('BEGIN')
        await client.query('SET LOCAL ROLE ofbo_app')
        await expect(
          client.query(`DELETE FROM ${table}`),
          `${table} must not be deletable`
        ).rejects.toThrow(/permission denied/i)
        await client.query('ROLLBACK')
        await client.query('BEGIN')
        await client.query('SET LOCAL ROLE ofbo_app')
      }
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
  })

  it('corrects a closed period by delta, leaving the original statement untouched', async () => {
    const previous = await persistStatement(fils(800), `dir-prev-${randomUUID()}`)

    // Same immutable facts, a corrected directory rate: the payable moves, the metering does not.
    const correctedSnapshotId = `dir-corr-${randomUUID()}`
    const meteredLines = await store.meteredLinesForRun(previous.meterRunId)
    const rating = rateUsage(meteredLines, SCHEME_RATE_CARD_2026_06_02, '2026-06', [], {
      overageSnapshot: snapshot(fils(400), correctedSnapshotId)
    })
    const corrected = buildExpectedTppCostStatement(rating, {
      tenantId: TENANCY.bankId,
      meterRunId: previous.meterRunId,
      generatedAt: '2026-08-01T02:00:00.000Z',
      ratingRunAt: '2026-08-01T01:59:00.000Z',
      pricingEffectiveFrom: SCHEME_RATE_CARD_2026_06_02.effectiveFrom,
      rateSnapshotHash: `sha256:pricing+${correctedSnapshotId}`,
      directorySnapshotId: correctedSnapshotId
    })
    const correctedSaved = await store.saveStatement(
      { meterRunId: previous.meterRunId, statement: corrected },
      'trace-correction'
    )
    expect(correctedSaved.created).toBe(true)

    const rerating = await store.saveRerating({
      meterRunId: previous.meterRunId,
      previousStatementId: previous.statementId,
      correctedStatementId: correctedSaved.record.id,
      correctionReference: `CORR-${randomUUID()}`,
      meteredFactsFingerprint: `sha256:facts-${previous.meterRunId}`,
      reratedAt: '2026-08-01T02:00:00.000Z',
      previous: previous.statement,
      corrected
    }, 'trace-correction')
    expect(rerating.created).toBe(true)

    const row = await admin.query(
      `SELECT previous_total_net_milli_fils AS prev, corrected_total_net_milli_fils AS corr,
              total_delta_net_milli_fils AS delta, facts_unchanged
         FROM billing_tpp_cost_rerating WHERE id = $1`,
      [rerating.id]
    )
    const record = row.rows[0]
    expect(Number(record.delta)).toBe(Number(record.corr) - Number(record.prev))
    // The corrected rate is lower, so the payable falls.
    expect(Number(record.corr)).toBeLessThan(Number(record.prev))
    expect(record.facts_unchanged).toBe(true)

    // The original statement is still exactly as written.
    const untouched = await store.statementById(previous.statementId)
    expect(untouched?.statement.totals).toEqual(previous.statement.totals)
  })

  it('refuses a correction that re-prices a different meter run — that is a re-meter, not a re-rate', async () => {
    const previous = await persistStatement(fils(800), `dir-a-${randomUUID()}`)
    const unrelated = await persistStatement(fils(800), `dir-b-${randomUUID()}`)

    await expect(store.saveRerating({
      meterRunId: previous.meterRunId,
      previousStatementId: previous.statementId,
      correctedStatementId: unrelated.statementId,
      correctionReference: `CORR-${randomUUID()}`,
      meteredFactsFingerprint: 'sha256:mismatched',
      reratedAt: '2026-08-01T02:00:00.000Z',
      previous: previous.statement,
      corrected: unrelated.statement
    }, 'trace-bad')).rejects.toThrow(/same meter run/i)
  })

  it('replays a re-rating at a later clock as a no-op, but still raises a genuinely different replay', async () => {
    const previous = await persistStatement(fils(800), `dir-prev-${randomUUID()}`)
    const correctedSnapshotId = `dir-corr-${randomUUID()}`
    const meteredLines = await store.meteredLinesForRun(previous.meterRunId)
    const rating = rateUsage(meteredLines, SCHEME_RATE_CARD_2026_06_02, '2026-06', [], {
      overageSnapshot: snapshot(fils(400), correctedSnapshotId)
    })
    const corrected = buildExpectedTppCostStatement(rating, {
      tenantId: TENANCY.bankId,
      meterRunId: previous.meterRunId,
      generatedAt: '2026-08-01T02:00:00.000Z',
      ratingRunAt: '2026-08-01T01:59:00.000Z',
      pricingEffectiveFrom: SCHEME_RATE_CARD_2026_06_02.effectiveFrom,
      rateSnapshotHash: `sha256:pricing+${correctedSnapshotId}`,
      directorySnapshotId: correctedSnapshotId
    })
    const correctedSaved = await store.saveStatement(
      { meterRunId: previous.meterRunId, statement: corrected }, 'trace-corr'
    )
    const reference = `CORR-${randomUUID()}`
    const input = {
      meterRunId: previous.meterRunId,
      previousStatementId: previous.statementId,
      correctedStatementId: correctedSaved.record.id,
      correctionReference: reference,
      meteredFactsFingerprint: `sha256:facts-${previous.meterRunId}`,
      reratedAt: '2026-08-01T02:00:00.000Z',
      previous: previous.statement,
      corrected
    }
    const first = await store.saveRerating(input, 'trace-corr')
    expect(first.created).toBe(true)

    // Replayed with both nested statements re-derived under a later clock: same correction.
    const laterClock = (s: ExpectedTppCostStatement, at: string): ExpectedTppCostStatement =>
      ({ ...s, evidence: { ...s.evidence, generatedAt: at, ratingRunAt: at } })
    const replayed = await store.saveRerating({
      ...input,
      previous: laterClock(previous.statement, '2026-08-02T09:00:00.000Z'),
      corrected: laterClock(corrected, '2026-08-02T09:00:00.000Z')
    }, 'trace-corr-replay')
    expect(replayed.created).toBe(false)
    expect(replayed.id).toBe(first.id)

    // But a replay whose SUBSTANCE differs under the same reference is still a conflict.
    await expect(store.saveRerating({
      ...input,
      corrected: { ...corrected, totals: { ...corrected.totals, totalNetMilliFils: corrected.totals.totalNetMilliFils + 1 } }
    }, 'trace-corr-divergent')).rejects.toThrow(/conflicting TPP cost re-rating/i)
  })

  it('raises a conflict when a regeneration diverges under the same key, rather than silently keeping the old one', async () => {
    const { statementId, meterRunId, statement } = await persistStatement(fils(800), `dir-${randomUUID()}`)

    // Same (meter run, rate card, rate snapshot) but different content: divergent evidence on an
    // immutable regulated record must be raised, not swallowed as a no-op.
    const tampered: ExpectedTppCostStatement = {
      ...statement,
      totals: { ...statement.totals, totalVatMilliFils: statement.totals.totalVatMilliFils + 1, totalGrossMilliFils: statement.totals.totalGrossMilliFils + 1 }
    }
    await expect(store.saveStatement({ meterRunId, statement: tampered }, 'trace-divergent'))
      .rejects.toThrow(/conflicting expected TPP cost statement/i)

    // The stored statement is untouched by the rejected attempt.
    expect((await store.statementById(statementId))?.statement.totals).toEqual(statement.totals)
  })

  /** An approval_request owned by `bankId`, so the dispatch FK below has something real to cite. */
  async function seedApprovalRequest(bankId: string): Promise<string> {
    const reference = `ar-${randomUUID()}`
    const client = await admin.connect()
    try {
      await client.query(
        `INSERT INTO approval_request
           (bank_id, channel, approval_request_id, operation_type, state, initiator,
            approver_required_scope, expires_at)
         VALUES ($1,'internal_retail',$2,'billing.tpp_cost.ap_dispatch','approved','finance.analyst',
                 'billing:write', now() + interval '2 hours')`,
        [bankId, reference]
      )
    } finally {
      client.release()
    }
    return reference
  }

  it('refuses a payable dispatch that one person both initiated and approved', async () => {
    // BILL-16 owns this write path; the four-eyes prohibition is enforced by the schema now so it
    // cannot be asserted in prose and forgotten.
    const reference = await seedApprovalRequest(TENANCY.bankId)
    const client = await admin.connect()
    try {
      await expect(client.query(
        `INSERT INTO billing_tpp_cost_ap_dispatch
           (bank_id, channel, statement_id, reconciliation_id, approval_request_id, initiated_by,
            approved_by, approved_at, dispatch_state, idempotency_key, payable_net_milli_fils,
            evidence_hash)
         VALUES ($1,'internal_retail',gen_random_uuid(),gen_random_uuid(),$2,'finance.analyst',
                 'finance.analyst',now(),'pending',$3,0,'sha256:x')`,
        [TENANCY.bankId, reference, randomUUID()]
      )).rejects.toThrow(/violates check constraint/i)
    } finally {
      client.release()
    }
  })

  it('refuses self-approval dressed up as a different string — case and padding do not count', async () => {
    // The CHECK is normalised, so 'Finance.Analyst' and ' finance.analyst ' are still one person.
    // What it cannot see — the same human under two different identifier FORMS — is BILL-16's
    // write-time obligation to stamp both columns from one normalised P2 claim.
    const reference = await seedApprovalRequest(TENANCY.bankId)
    const client = await admin.connect()
    try {
      await expect(client.query(
        `INSERT INTO billing_tpp_cost_ap_dispatch
           (bank_id, channel, statement_id, reconciliation_id, approval_request_id, initiated_by,
            approved_by, approved_at, dispatch_state, idempotency_key, payable_net_milli_fils,
            evidence_hash)
         VALUES ($1,'internal_retail',gen_random_uuid(),gen_random_uuid(),$2,' finance.analyst ',
                 'Finance.Analyst',now(),'pending',$3,0,'sha256:x')`,
        [TENANCY.bankId, reference, randomUUID()]
      )).rejects.toThrow(/violates check constraint/i)
    } finally {
      client.release()
    }
  })

  it('withholds cross-tenant internal-view reads on the two provider-fed payload tables', async () => {
    // Least privilege while redaction is still owed by BILL-14/BILL-16: the free-form provider
    // columns must not be readable across the tenant boundary by inheriting a loop's grant.
    const granted = await admin.query(
      `SELECT table_name FROM information_schema.role_table_grants
        WHERE grantee = 'bank_internal_view' AND privilege_type = 'SELECT'
          AND table_name LIKE 'billing_tpp_cost%'`
    )
    const names = granted.rows.map((row) => row.table_name as string)
    expect(names).not.toContain('billing_tpp_cost_document')
    expect(names).not.toContain('billing_tpp_cost_ap_dispatch')
    // The schema-constrained, PSU-free relations keep the ratified governed-aggregate access.
    expect(names).toContain('billing_tpp_cost_statement')
    expect(names).toContain('billing_tpp_cost_statement_line')
  })

  it('binds the four-eyes approval reference to the tenant, not just to a global id', async () => {
    // The control: an approval cannot be borrowed across the tenant boundary. A single-column FK
    // against approval_request's globally-unique approval_request_id would have allowed exactly that.
    //
    // Asserted on the constraint's DEFINITION rather than by a rejected insert, deliberately. An
    // insert would have to satisfy this table's statement_id and reconciliation_id foreign keys
    // first, and those reference billing_tpp_cost_statement and billing_tpp_cost_reconciliation —
    // so a dispatch row with fabricated parents fails on whichever FK Postgres checks first, and
    // `/violates foreign key constraint/` matches all three indiscriminately. That assertion would
    // pass whether or not the composite approval FK existed at all, which is no evidence.
    //
    // Nor can the parents simply be created here: billing_tpp_cost_reconciliation requires a
    // billing_tpp_cost_document row, and writing that table would make the Q4.5 lineage gate demand
    // lineage BILL-13 does not emit for it (the gate skips only empty tables). The catalogue is
    // therefore both the precise and the safe place to assert the shape.
    const fks = await admin.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'billing_tpp_cost_ap_dispatch'::regclass AND contype = 'f'`
    )
    const defs = fks.rows.map((row) => (row.def as string).replace(/\s+/g, ' '))

    expect(defs).toContain(
      'FOREIGN KEY (bank_id, approval_request_id) REFERENCES approval_request(bank_id, approval_request_id)'
    )
    // And nothing references the approval by its global id alone.
    expect(defs.some((def) => /FOREIGN KEY \(approval_request_id\)/.test(def))).toBe(false)

    // The composite FK is only enforceable because approval_request carries the matching key.
    const unique = await admin.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'approval_request'::regclass AND contype = 'u'`
    )
    expect(unique.rows.map((row) => (row.def as string).replace(/\s+/g, ' ')))
      .toContain('UNIQUE (bank_id, approval_request_id)')
  })

  it('carries the payable ledger into the tenant portable export, with rows and not just a table name', async () => {
    // The claim BILL-13 makes is that a tenant can take its payable evidence with it. Adding the
    // three tables to EXPORT_TABLES was previously asserted nowhere — dropping any of the names
    // would not have turned a test red, which is no evidence for a portability guarantee.
    const { statementId } = await persistStatement(fils(800), `dir-${randomUUID()}`)

    const exportStore = new PgTenantBillingServiceStore(
      DATABASE_URL!,
      (bankId: string) => new PgLineageEmitter(DATABASE_URL!, { bankId, channel: 'internal_retail' }),
      { emit: async () => {} }
    )
    try {
      const exported = await exportStore.portableExport(TENANCY.bankId, '2026-08-17T00:00:00.000Z')

      for (const table of ['billing_tpp_cost_statement', 'billing_tpp_cost_statement_line']) {
        expect(exported.recordCounts[table], `${table} missing from export`).toBeGreaterThanOrEqual(1)
      }
      // The statement just written is actually in the payload, not merely counted.
      expect(exported.tables.billing_tpp_cost_statement?.some((row) => row.id === statementId)).toBe(true)
      // And the two tables whose provider-fed payloads BILL-13 withholds stay out of it.
      expect(exported.recordCounts.billing_tpp_cost_document).toBeUndefined()
      expect(exported.recordCounts.billing_tpp_cost_ap_dispatch).toBeUndefined()
    } finally {
      await exportStore.close()
    }
  })

  it('emits BCBS 239 lineage for every cost table it writes', async () => {
    await persistStatement(fils(800), `dir-${randomUUID()}`)

    const rows = await admin.query(
      `SELECT DISTINCT table_name FROM lineage_events WHERE table_name LIKE 'billing_tpp_cost%'`
    )
    const covered = rows.rows.map((row) => row.table_name as string)
    expect(covered).toContain('billing_tpp_cost_statement')
    expect(covered).toContain('billing_tpp_cost_statement_line')
  })
})
