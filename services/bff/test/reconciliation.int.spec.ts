import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgLineageEmitter, PgReconciliationLogStore } from '@ofbo/db'
import { ReconciliationService } from '../src/reconciliation/service.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'

/**
 * BACKOFFICE-01 integration: a daily run persists a reconciliation_log row with
 * the matched/unmatched/disputed counts under RLS, emits BCBS 239 lineage for
 * reconciliation_log, and is idempotent on run_id (a re-run writes no second
 * row) — against real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const WINDOW = { start: '2026-08-10T00:00:00.000Z', end: '2026-08-11T00:00:00.000Z' }
const RUN_ID = 'recon-2026-08-10-daily'

describe('reconciliation run — persistence + counts + lineage + idempotency', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const store = new PgReconciliationLogStore(url!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(url!)
    await admin.query(`DELETE FROM reconciliation_log WHERE run_id = $1`, [RUN_ID])
  })
  afterAll(async () => {
    await store.close()
    await lineage.close()
    await admin.end()
  })

  it('persists reconciliation_log with line counts + lineage, idempotent on run_id', async () => {
    const trace = randomUUID()
    const audit = new PgAuditEmitter(url!, TENANCY, lineage)
    const service = new ReconciliationService({ store, audit })
    const first = await service.runDaily(trace, { window: WINDOW })
    expect(first.created).toBe(true)
    expect(first.run.run_id).toBe(RUN_ID)
    expect(first.run.line_count_matched).toBe(100)
    expect(first.run.line_count_unmatched).toBe(8)
    expect(first.run.line_count_disputed).toBe(2)

    const row = await admin.query(
      `SELECT run_type, status, line_count_total, line_count_matched, line_count_unmatched, line_count_disputed FROM reconciliation_log WHERE run_id = $1`,
      [RUN_ID]
    )
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0].status).toBe('completed')
    expect(row.rows[0].line_count_total).toBe(110)

    const lin = await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'reconciliation_log'`, [trace])
    expect(lin.rows.length).toBeGreaterThan(0)

    const ev = await admin.query(
      `SELECT 1 FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'reconciliation_run_completed'`,
      [trace]
    )
    expect(ev.rows).toHaveLength(1)
    await audit.close()

    // Idempotent re-run: same run_id ⇒ no second row, created=false.
    const audit2 = new InMemoryHighClassAuditSink()
    const replay = await new ReconciliationService({ store, audit: audit2 }).runDaily(randomUUID(), { window: WINDOW })
    expect(replay.created).toBe(false)
    const count = await admin.query(`SELECT count(*)::int AS n FROM reconciliation_log WHERE run_id = $1`, [RUN_ID])
    expect(count.rows[0].n).toBe(1)
    expect(audit2.events).toHaveLength(0) // no audit on an idempotent no-op
  })
})
