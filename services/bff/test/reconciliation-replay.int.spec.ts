import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgLineageEmitter, PgReconciliationLogStore } from '@ofbo/db'
import { ReconciliationService } from '../src/reconciliation/service.js'
import { mintScopes, type Principal } from '../src/auth.js'

/**
 * BACKOFFICE-10 integration: a replay over a date range persists a reconciliation_log
 * row (run_type=replay) under RLS, emits BCBS 239 lineage, High-class audits the human
 * initiator (reconciliation_replay_requested), and is idempotent on the window — a
 * repeat replay writes no second run and emits no second run-completion audit.
 * Against real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const WINDOW = { start: '2026-09-10T00:00:00.000Z', end: '2026-09-11T00:00:00.000Z' }
const RUN_ID = 'recon-replay-2026-09-10_2026-09-11'
const OPS: Principal = { subject: 'demo:operations-analyst', persona: 'operations-analyst', scopes: mintScopes('operations-analyst') }

describe('reconciliation replay — persistence + lineage + initiator audit + idempotency', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const store = new PgReconciliationLogStore(url!, TENANCY, lineage)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(url!)
    await admin.query(`DELETE FROM reconciliation_log WHERE run_id = $1`, [RUN_ID])
  })
  afterAll(async () => {
    await store.close()
    await audit.close()
    await lineage.close()
    await admin.end()
  })

  it('persists a replay run with lineage + initiator audit, idempotent on the window', async () => {
    const service = new ReconciliationService({ store, audit })
    const trace = randomUUID()
    const first = await service.replay(OPS, WINDOW, trace)
    expect(first.created).toBe(true)
    expect(first.run.run_id).toBe(RUN_ID)
    expect(first.run.run_type).toBe('replay')

    const row = await admin.query(`SELECT run_type, status FROM reconciliation_log WHERE run_id = $1`, [RUN_ID])
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0].run_type).toBe('replay')
    expect(row.rows[0].status).toBe('completed')

    // BCBS 239 lineage emitted for the replay run
    const lin = await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'reconciliation_log'`, [trace])
    expect(lin.rows.length).toBeGreaterThan(0)

    // the human initiator is audited (not the system engine)
    const init = await admin.query(
      `SELECT acting_principal, acting_persona FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'reconciliation_replay_requested'`,
      [trace]
    )
    expect(init.rows).toHaveLength(1)
    expect(init.rows[0].acting_persona).toBe('operations-analyst')
    expect(init.rows[0].acting_principal).not.toMatch(/^system:/)

    // Idempotent re-replay of the same window: no second run; run-completion audit not re-emitted.
    const trace2 = randomUUID()
    const second = await service.replay(OPS, WINDOW, trace2)
    expect(second.created).toBe(false)
    const count = await admin.query(`SELECT count(*)::int AS n FROM reconciliation_log WHERE run_id = $1`, [RUN_ID])
    expect(count.rows[0].n).toBe(1)
    const completed2 = await admin.query(
      `SELECT 1 FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'reconciliation_run_completed'`,
      [trace2]
    )
    expect(completed2.rows).toHaveLength(0) // no run-completion audit on an idempotent no-op
  })
})
