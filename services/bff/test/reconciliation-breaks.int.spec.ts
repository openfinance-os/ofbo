import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgLineageEmitter, PgReconciliationBreakStore, PgReconciliationLogStore } from '@ofbo/db'
import { ReconciliationService } from '../src/reconciliation/service.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'

/**
 * BACKOFFICE-02 integration: a run with break detection persists
 * reconciliation_break rows under RLS (status flagged, all three source refs,
 * sla clock started), emits BCBS 239 lineage for reconciliation_break, and is
 * idempotent on run_id — against real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const WINDOW = { start: '2026-09-10T00:00:00.000Z', end: '2026-09-11T00:00:00.000Z' }
const RUN_ID = 'recon-2026-09-10-daily'

class FakeItsm {
  async createTicket() {
    return { ticket_id: 't' }
  }
}

describe('break detection — persistence + lineage + idempotency', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const logStore = new PgReconciliationLogStore(url!, TENANCY, lineage)
  const breakStore = new PgReconciliationBreakStore(url!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(url!)
    await admin.query(`DELETE FROM reconciliation_break WHERE run_id = $1`, [RUN_ID])
    await admin.query(`DELETE FROM reconciliation_log WHERE run_id = $1`, [RUN_ID])
  })
  afterAll(async () => {
    await logStore.close()
    await breakStore.close()
    await lineage.close()
    await admin.end()
  })

  it('persists flagged breaks with source refs + lineage; idempotent re-run adds none', async () => {
    const trace = randomUUID()
    const audit = new PgAuditEmitter(url!, TENANCY, lineage)
    const service = new ReconciliationService({ store: logStore, breakStore, itsm: new FakeItsm(), audit })
    const run = await service.runDaily(trace, { window: WINDOW })
    expect(run.created).toBe(true)
    expect(run.breaks.length).toBe(8)

    const rows = await admin.query(
      `SELECT status, line_type, source_a_ref, source_b_ref, variance_amount, sla_clock_started_at, reopened_count
         FROM reconciliation_break WHERE run_id = $1`,
      [RUN_ID]
    )
    expect(rows.rows).toHaveLength(8)
    expect(rows.rows.every((r) => r.status === 'flagged')).toBe(true)
    expect(rows.rows.every((r) => r.source_a_ref && r.source_b_ref)).toBe(true)
    expect(rows.rows.every((r) => r.sla_clock_started_at !== null)).toBe(true)
    expect(rows.rows.every((r) => r.reopened_count === 0)).toBe(true)

    const lin = await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'reconciliation_break'`, [trace])
    expect(lin.rows.length).toBeGreaterThan(0)
    await audit.close()

    // idempotent re-run: same run_id ⇒ no new breaks
    const replay = await new ReconciliationService({ store: logStore, breakStore, itsm: new FakeItsm(), audit: new InMemoryHighClassAuditSink() }).runDaily(randomUUID(), { window: WINDOW })
    expect(replay.created).toBe(false)
    const count = await admin.query(`SELECT count(*)::int AS n FROM reconciliation_break WHERE run_id = $1`, [RUN_ID])
    expect(count.rows[0].n).toBe(8)
  })
})
