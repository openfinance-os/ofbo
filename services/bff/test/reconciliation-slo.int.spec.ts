import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgLineageEmitter, PgReconciliationBreakStore } from '@ofbo/db'
import { ReconciliationSloService } from '../src/analytics/reconciliation-slo.js'
import type { Principal } from '../src/auth.js'

/**
 * BACKOFFICE-09 — verifies the migration-0020 resolved_at column over real Postgres:
 * resolve() stamps resolved_at (RLS UPDATE), and the SLO view's 30-day resolution
 * sample picks it up. Exercises the break store as ofbo_app (RLS).
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const reconRead: Principal = { subject: 'svc:slo-int', persona: 'finance-analyst', scopes: ['reconciliation:read'] }

describe('reconciliation SLO — resolved_at persistence + 30-day resolution sample', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const breaks = new PgReconciliationBreakStore(url!, TENANCY, lineage)
  // The SLO view only reads (listForRange); runs reader stubbed (covered by unit tests).
  const slo = new ReconciliationSloService({ breaks, runs: { list: async () => ({ rows: [], next_cursor: null }) } })

  beforeAll(async () => {
    await applyMigrations(url!)
  }, 60_000)
  afterAll(async () => {
    await lineage.close()
    await breaks.close()
    await admin.end()
  })

  it('resolve() stamps resolved_at and the SLO 30-day resolution sample includes it', async () => {
    const trace = randomUUID()
    const runId = `recon-slo-int-${trace.slice(0, 8)}`
    const created = await breaks.createMany(
      [{ run_id: runId, line_type: 'nebras_fees', source_a_ref: 'a1', source_b_ref: 'b1' }],
      trace
    )
    const breakId = created[0]!.id
    expect(created[0]!.resolved_at).toBeNull()

    const resolved = await breaks.resolve(breakId, 'resolved_matched', 'Matched after manual review of the three sources.', trace)
    expect(resolved!.resolved_at).not.toBeNull()

    const row = await admin.query(`SELECT resolved_at FROM reconciliation_break WHERE id = $1`, [breakId])
    expect(row.rows[0].resolved_at).not.toBeNull()

    const { data } = await slo.view(reconRead)
    const res = data.resolution_time_30d as { sample_size: number }
    expect(res.sample_size).toBeGreaterThanOrEqual(1)
  }, 60_000)
})
