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
    const audit = await admin.query(
      `SELECT count(*)::int AS n FROM audit_high_sensitivity WHERE event_type LIKE 'consent_%'`
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
})
