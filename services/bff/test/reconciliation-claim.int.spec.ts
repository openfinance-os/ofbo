import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgLineageEmitter, PgReconciliationBreakStore } from '@ofbo/db'

/**
 * BACKOFFICE-03 integration: claiming a flagged break transitions it to assigned
 * under RLS (records the claimant + SLA clock), emits reconciliation_break
 * lineage, and the flagged→assigned guard makes a second claim a no-op — against
 * real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const RUN_ID = 'recon-claim-int-run'

describe('break claim — RLS transition + lineage + atomic guard', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const store = new PgReconciliationBreakStore(url!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(url!)
    await admin.query(`DELETE FROM reconciliation_break WHERE run_id = $1`, [RUN_ID])
  })
  afterAll(async () => {
    await store.close()
    await lineage.close()
    await admin.end()
  })

  it('claims a flagged break → assigned with claimant + SLA clock + lineage; second claim is a no-op', async () => {
    const trace = randomUUID()
    const [created] = await store.createMany(
      [{ run_id: RUN_ID, line_type: 'payment_settlement', variance_amount: { amount: 7, currency: 'AED' }, source_a_ref: 'N1', source_b_ref: 'P1' }],
      trace
    )
    expect(created!.status).toBe('flagged')

    const claimTrace = randomUUID()
    const claimed = await store.claim(created!.id, 'demo:finance-analyst', claimTrace)
    expect(claimed?.status).toBe('assigned')
    expect(claimed?.assigned_to).toBe('demo:finance-analyst')
    expect(claimed?.sla_clock_started_at).toBeTruthy()

    const row = await admin.query(`SELECT status, assigned_to FROM reconciliation_break WHERE id = $1`, [created!.id])
    expect(row.rows[0].status).toBe('assigned')
    expect(row.rows[0].assigned_to).toBe('demo:finance-analyst')

    const lin = await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'reconciliation_break'`, [claimTrace])
    expect(lin.rows.length).toBeGreaterThan(0)

    // second claim: the flagged→assigned guard updates 0 rows
    const again = await store.claim(created!.id, 'demo:other-analyst', randomUUID())
    expect(again).toBeNull()
    const still = await admin.query(`SELECT assigned_to FROM reconciliation_break WHERE id = $1`, [created!.id])
    expect(still.rows[0].assigned_to).toBe('demo:finance-analyst') // unchanged
  })
})
