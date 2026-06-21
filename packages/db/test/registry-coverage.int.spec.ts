import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { applyMigrations } from '../src/apply.js'

/**
 * Registry coverage: every regulated record table must be enrolled in BOTH the
 * retention_policy and classification_policy registries and carry a NOT NULL
 * classification column (BACKOFFICE-50 / -54: a binding, queryable retention +
 * classification posture for every record).
 *
 * Each feature migration enrols its own table inline, so coverage is already
 * complete — this locks it in as a CI gate so a future migration that adds a
 * regulated table but forgets to enrol it (or its classification column) is caught
 * here rather than at review. The regulated surface is derived from the privilege
 * catalogue (every table ofbo_app can INSERT into), so new tables are covered
 * automatically — unlike the hardcoded list in classification.int.spec.ts.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required for integration tests')

// The operational 24h idempotency replay cache is the one INSERT-granted table that is
// not a regulated record: it is the schema's sole deletion path and is exempt from
// retention enrolment (it still carries a classification column + floor for completeness).
const RETENTION_EXEMPT = new Set(['idempotency_key'])

describe('registry coverage — every regulated table is enrolled (retention + classification)', () => {
  const admin = new pg.Pool({ connectionString: url })
  beforeAll(async () => {
    await applyMigrations(url)
  })
  afterAll(async () => {
    await admin.end()
  })

  /** Every table the application role can write — the regulated record surface. */
  async function insertableTables(): Promise<string[]> {
    const { rows } = await admin.query(
      `SELECT DISTINCT table_name FROM information_schema.role_table_grants
        WHERE grantee = 'ofbo_app' AND privilege_type = 'INSERT' AND table_schema = 'public'
        ORDER BY table_name`
    )
    return rows.map((r) => r.table_name as string)
  }

  it('every record table is in retention_policy with the binding 24/60/no-deletion posture', async () => {
    const tables = (await insertableTables()).filter((t) => !RETENTION_EXEMPT.has(t))
    expect(tables.length).toBeGreaterThan(0)

    const { rows } = await admin.query(
      `SELECT table_name, hot_months, immutable_months, deletion_allowed FROM retention_policy`
    )
    const policy = new Map(rows.map((r) => [r.table_name as string, r]))

    const missing = tables.filter((t) => !policy.has(t))
    expect(missing, 'regulated tables missing from retention_policy').toEqual([])
    for (const t of tables) {
      const p = policy.get(t)!
      expect(p.hot_months, t).toBe(24)
      expect(p.immutable_months, t).toBe(60)
      expect(p.deletion_allowed, t).toBe(false)
    }
  })

  it('every writable table has a classification_policy floor and a NOT NULL classification column', async () => {
    const tables = await insertableTables()

    const floors = await admin.query(`SELECT table_name FROM classification_policy`)
    const hasFloor = new Set(floors.rows.map((r) => r.table_name as string))
    const missingFloor = tables.filter((t) => !hasFloor.has(t))
    expect(missingFloor, 'writable tables missing a classification_policy floor').toEqual([])

    const cols = await admin.query(
      `SELECT table_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'classification'`
    )
    const colNullable = new Map(cols.rows.map((r) => [r.table_name as string, r.is_nullable as string]))
    const missingCol = tables.filter((t) => !colNullable.has(t))
    expect(missingCol, 'writable tables missing a classification column').toEqual([])
    for (const t of tables) expect(colNullable.get(t), t).toBe('NO')
  })
})
