import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgLineageEmitter, PgReconciliationBreakStore } from '@ofbo/db'

/**
 * BACKOFFICE-68 — migration 0021 extends the reconciliation_break line_type CHECK to
 * admit dao_api_call. Verifies a DAO break persists over real Postgres (RLS via ofbo_app);
 * before the migration this INSERT violated reconciliation_break_line_type_check.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }

describe('DAO reconciliation break — persistence (extended line_type CHECK)', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const breaks = new PgReconciliationBreakStore(url!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(url!)
  }, 60_000)
  afterAll(async () => {
    await lineage.close()
    await breaks.close()
    await admin.end()
  })

  it('persists a dao_api_call break', async () => {
    const trace = randomUUID()
    const runId = `recon-dao-int-${trace.slice(0, 8)}`
    const created = await breaks.createMany(
      [
        {
          run_id: runId,
          line_type: 'dao_api_call',
          variance_amount: { amount: 4, currency: 'AED' },
          source_a_ref: `${runId}-a`,
          source_b_ref: `${runId}-b`
        }
      ],
      trace
    )
    expect(created[0]!.line_type).toBe('dao_api_call')

    const row = await admin.query(`SELECT line_type FROM reconciliation_break WHERE id = $1`, [created[0]!.id])
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0].line_type).toBe('dao_api_call')
  }, 60_000)
})
