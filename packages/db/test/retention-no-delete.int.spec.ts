import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { applyMigrations } from '../src/apply.js'

/**
 * Retention hard-stop (CLAUDE.md / PRD §5): there is NO deletion path for regulated
 * records. This is enforced by privilege, not a trigger — the application role
 * `ofbo_app` is granted SELECT/INSERT(/UPDATE) on every workflow/record table but
 * never DELETE; the audit table additionally REVOKEs it. (A BEFORE DELETE trigger
 * would be wrong here: it would also block the superuser-role test/ops cleanup and
 * TRUNCATE-based db:reset, for no gain against the actual threat model — the app role.)
 *
 * This suite locks that invariant in as a CI gate so a future migration that
 * accidentally `GRANT ... DELETE`s to ofbo_app on a regulated table is caught, rather
 * than relying on a reviewer noticing. It derives the regulated surface from the
 * privilege catalogue, so new tables are covered automatically.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required for integration tests')

// The schema's one sanctioned deletion path: the operational 24h idempotency replay
// cache — not a regulated record (see 0003_rls.sql / 0009_durable_stores.sql).
const DELETE_ALLOWED = new Set(['idempotency_key'])

// A floor the catalogue-derived check must contain — guards against the catalogue
// query silently returning [] (which would make the invariant vacuously pass).
const KNOWN_REGULATED = [
  'reconciliation_log',
  'reconciliation_break',
  'dispute_case',
  'audit_high_sensitivity',
  'compliance_report',
  'risk_signal',
  'approval_request',
  'query_purpose_registry',
  'tpp_counterparty',
  'lineage_events',
  'billing_record_set',
  'invoice_run',
  'fraud_incident',
  'respondent_dispute',
  'scheme_notification',
  'service_desk_case',
  'trust_framework_participant'
]

describe('retention hard-stop — no DELETE path for regulated records (ofbo_app)', () => {
  const admin = new pg.Pool({ connectionString: url })
  beforeAll(async () => {
    await applyMigrations(url)
  })
  afterAll(async () => {
    await admin.end()
  })

  it('the application role holds no DELETE on any table it can INSERT into (except the idempotency cache)', async () => {
    const { rows } = await admin.query(
      `SELECT DISTINCT table_name FROM information_schema.role_table_grants
        WHERE grantee = 'ofbo_app' AND privilege_type = 'INSERT' AND table_schema = 'public'
        ORDER BY table_name`
    )
    const insertable = rows.map((r) => r.table_name as string)
    expect(insertable.length).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const t of insertable) {
      if (DELETE_ALLOWED.has(t)) continue
      const can = await admin.query(`SELECT has_table_privilege('ofbo_app', $1, 'DELETE') AS d`, [t])
      if (can.rows[0].d === true) offenders.push(t)
    }
    expect(offenders, 'regulated tables that wrongly grant DELETE to ofbo_app').toEqual([])

    // the catalogue actually covered the known regulated surface
    for (const t of KNOWN_REGULATED) expect(insertable, t).toContain(t)
  })

  it('idempotency_key is the sole sanctioned deletion path', async () => {
    const can = await admin.query(`SELECT has_table_privilege('ofbo_app', 'idempotency_key', 'DELETE') AS d`)
    expect(can.rows[0].d).toBe(true)
  })
})
