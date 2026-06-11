import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { applyMigrations } from '../src/apply.js'

/**
 * Integration tests against a real Postgres (DATABASE_URL must point at a
 * superuser-capable scratch database — dockerised locally, service container in CI).
 */
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required for integration tests')

const admin = new pg.Pool({ connectionString: url })

const BANK_A = '11111111-1111-4111-8111-111111111111'
const BANK_B = '22222222-2222-4222-8222-222222222222'

async function asApp<T>(bankId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await admin.connect()
  try {
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE ofbo_app')
    await c.query(`SELECT set_config('app.bank_id', $1, true)`, [bankId])
    const out = await fn(c)
    await c.query('COMMIT')
    return out
  } catch (e) {
    await c.query('ROLLBACK')
    throw e
  } finally {
    c.release()
  }
}

const TABLES = [
  'reconciliation_log',
  'reconciliation_break',
  'dispute_case',
  'audit_high_sensitivity',
  'compliance_report',
  'risk_signal',
  'approval_request',
  'query_purpose_registry',
  'tpp_counterparty'
]

function insertAudit(c: pg.PoolClient, bankId: string) {
  return c.query(
    `INSERT INTO audit_high_sensitivity
       (bank_id, channel, event_type, acting_principal, acting_persona, scope_used, request_trace_id, request_body_redacted, response_status)
     VALUES ($1, 'internal_retail', 'psu_lookup', 'agent-001', 'customer-care-agent', 'consents:admin',
             '4d2c2e2a-0000-4000-8000-000000000000', '{}'::jsonb, 200)
     RETURNING id`,
    [bankId]
  )
}

describe('M0 schema', () => {
  beforeAll(async () => {
    await applyMigrations(url)
  })
  afterAll(async () => {
    await admin.end()
  })

  it('creates the 9 tables and the consent_admin_event materialized view', async () => {
    const t = await admin.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`
    )
    const names = t.rows.map((r) => r.table_name)
    for (const table of TABLES) expect(names, table).toContain(table)
    const mv = await admin.query(`SELECT matviewname FROM pg_matviews WHERE schemaname='public'`)
    expect(mv.rows.map((r) => r.matviewname)).toContain('consent_admin_event')
  })

  it('is idempotent — applying twice is a no-op', async () => {
    await expect(applyMigrations(url)).resolves.not.toThrow()
  })

  it('audit_high_sensitivity accepts INSERT but rejects UPDATE and DELETE as ofbo_app', async () => {
    const id = await asApp(BANK_A, async (c) => (await insertAudit(c, BANK_A)).rows[0].id)
    await expect(
      asApp(BANK_A, (c) => c.query(`UPDATE audit_high_sensitivity SET response_status=500 WHERE id=$1`, [id]))
    ).rejects.toThrow(/permission denied/)
    await expect(
      asApp(BANK_A, (c) => c.query(`DELETE FROM audit_high_sensitivity WHERE id=$1`, [id]))
    ).rejects.toThrow(/permission denied/)
  })

  it('rows are invisible across bank_id for ofbo_app (RLS tenancy)', async () => {
    await asApp(BANK_A, (c) => insertAudit(c, BANK_A))
    const visible = await asApp(BANK_B, async (c) => {
      const r = await c.query(`SELECT count(*)::int AS n FROM audit_high_sensitivity WHERE bank_id=$1`, [BANK_A])
      return r.rows[0].n
    })
    expect(visible).toBe(0)
  })

  it('ofbo_app cannot insert a row for another bank_id (WITH CHECK)', async () => {
    await expect(asApp(BANK_B, (c) => insertAudit(c, BANK_A))).rejects.toThrow(/row-level security|policy/)
  })

  it('bank_internal_view can SELECT across banks but cannot INSERT', async () => {
    await asApp(BANK_A, (c) => insertAudit(c, BANK_A))
    const c = await admin.connect()
    try {
      await c.query('BEGIN')
      await c.query('SET LOCAL ROLE bank_internal_view')
      const r = await c.query(
        `SELECT count(DISTINCT bank_id)::int AS n FROM audit_high_sensitivity WHERE bank_id IN ($1,$2)`,
        [BANK_A, BANK_B]
      )
      expect(r.rows[0].n).toBeGreaterThanOrEqual(1)
      await expect(insertAudit(c, BANK_A)).rejects.toThrow(/permission denied|row-level security/)
      await c.query('ROLLBACK')
    } finally {
      c.release()
    }
  })

  it('money columns are integer minor units (bigint), never numeric/float', async () => {
    const r = await admin.query(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
       WHERE table_schema='public' AND column_name LIKE '%_amount'`
    )
    expect(r.rows.length).toBeGreaterThan(0)
    for (const row of r.rows) {
      expect(row.data_type, `${row.table_name}.${row.column_name}`).toBe('bigint')
    }
  })
})
