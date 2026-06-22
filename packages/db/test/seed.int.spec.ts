import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { applyMigrations } from '../src/apply.js'
import { seedDemoDataset } from '../src/seed.js'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required for integration tests')
const admin = new pg.Pool({ connectionString: url })

describe('demo seed', () => {
  beforeAll(async () => {
    await applyMigrations(url)
    await seedDemoDataset(url)
  })
  afterAll(async () => {
    await admin.end()
  })

  it('seeds the TPP counterparty registry', async () => {
    const r = await admin.query(`SELECT count(*)::int AS n FROM tpp_counterparty`)
    expect(r.rows[0].n).toBeGreaterThanOrEqual(3)
  })

  it('seeds consent lifecycle audit events and refreshes the mirror', async () => {
    // Compare the mirror to the exact event set it materialises — not a broad
    // `consent_%` (which also matches consent_search etc. from other suites in
    // this shared DB), which would make the count order-dependent.
    const audit = await admin.query(
      `SELECT count(*)::int AS n FROM audit_high_sensitivity
         WHERE event_type IN ('consent_granted','consent_accessed','consent_modified','consent_revoked')`
    )
    expect(audit.rows[0].n).toBeGreaterThan(0)
    const mirror = await admin.query(`SELECT count(*)::int AS n FROM consent_admin_event`)
    expect(mirror.rows[0].n).toBe(audit.rows[0].n)
  })

  it('is idempotent — re-seeding does not duplicate', async () => {
    const before = await admin.query(`SELECT count(*)::int AS n FROM audit_high_sensitivity`)
    await seedDemoDataset(url)
    const after = await admin.query(`SELECT count(*)::int AS n FROM audit_high_sensitivity`)
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })

  it('stores zero real-PII shapes', async () => {
    const r = await admin.query(`SELECT coalesce(string_agg(target_psu_identifier, ' '), '') AS blob FROM audit_high_sensitivity`)
    expect(r.rows[0].blob.replace(/[\s-]/g, '')).not.toMatch(/784\d{12}/)
  })

  it('seeds the BD-13 cross-fintech query purposes pre-approved (so governed reads pass the gate)', async () => {
    const r = await admin.query(
      `SELECT count(*)::int AS n FROM query_purpose_registry WHERE approved_by IS NOT NULL
         AND purpose_code IN ('executive_dashboard','finance_view','risk_monitoring','operations_monitoring','compliance_reporting','regulatory_periodic_report')`
    )
    expect(r.rows[0].n).toBe(6)
    // BCBS 239 lineage for the registry write (Q4.5 stays green on a seed-only DB)
    const lin = await admin.query(`SELECT count(*)::int AS n FROM lineage_events WHERE table_name = 'query_purpose_registry'`)
    expect(lin.rows[0].n).toBeGreaterThan(0)
  })
})
