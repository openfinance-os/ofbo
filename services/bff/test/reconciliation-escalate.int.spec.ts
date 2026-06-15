import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgLineageEmitter, PgReconciliationBreakStore } from '@ofbo/db'

/**
 * BACKOFFICE-05 integration: escalating a break to a Nebras dispute persists the
 * Nebras case id + status escalated_nebras_dispute under RLS, emits
 * reconciliation_break lineage, and the flagged/assigned guard makes a second
 * escalation a no-op — against real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const RUN_ID = 'recon-escalate-int-run'

describe('break escalate-nebras — RLS transition + Nebras case id + lineage', () => {
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

  it('persists the Nebras case id + escalated status with lineage; second escalate is a no-op', async () => {
    const [created] = await store.createMany(
      [{ run_id: RUN_ID, line_type: 'nebras_fees', variance_amount: { amount: 12, currency: 'AED' }, source_a_ref: 'N1', source_b_ref: 'P1' }],
      randomUUID()
    )
    const id = created!.id

    const trace = randomUUID()
    const escalated = await store.escalateNebras(id, 'nebras-case-xyz', trace)
    expect(escalated?.status).toBe('escalated_nebras_dispute')
    expect(escalated?.nebras_dispute_case_id).toBe('nebras-case-xyz')

    const row = await admin.query(`SELECT status, nebras_dispute_case_id FROM reconciliation_break WHERE id = $1`, [id])
    expect(row.rows[0].status).toBe('escalated_nebras_dispute')
    expect(row.rows[0].nebras_dispute_case_id).toBe('nebras-case-xyz')
    expect((await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'reconciliation_break'`, [trace])).rows.length).toBeGreaterThan(0)

    // already terminal ⇒ second escalation is a 0-row no-op
    expect(await store.escalateNebras(id, 'nebras-case-dup', randomUUID())).toBeNull()
    const still = await admin.query(`SELECT nebras_dispute_case_id FROM reconciliation_break WHERE id = $1`, [id])
    expect(still.rows[0].nebras_dispute_case_id).toBe('nebras-case-xyz') // unchanged
  })
})
