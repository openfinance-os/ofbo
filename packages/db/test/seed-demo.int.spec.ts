import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { applyMigrations } from '../src/apply.js'
import { seedDemoDataset } from '../src/seed.js'
import { seedDemoScenario } from '../src/seed-demo.js'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required for integration tests')
const admin = new pg.Pool({ connectionString: url })

/**
 * DEMO-01 — the rich "operating back office" scenario (seed-demo.ts). Counts are scoped by the
 * scenario's own natural-key markers (NOT raw table counts) because the integration DB is shared
 * across suites. Asserts the seeded depth, the INC-2026-0042 cross-console linkage, and that the
 * scenario stays idempotent (it runs on every demo deploy).
 */
describe('demo scenario seed', () => {
  beforeAll(async () => {
    await applyMigrations(url)
    await seedDemoDataset(url)
    await seedDemoScenario(url)
  })
  afterAll(async () => {
    await admin.end()
  })

  it('seeds 13 scenario risk signals (12 + the incident)', async () => {
    const r = await admin.query(`SELECT count(*)::int AS n FROM risk_signal WHERE signal_data->>'source' = 'demo-scenario'`)
    expect(r.rows[0].n).toBe(13)
  })

  it('seeds 4 pending four-eyes approvals', async () => {
    const r = await admin.query(`SELECT count(*)::int AS n FROM approval_request WHERE approval_request_id LIKE 'demo-appr-%' AND state = 'pending'`)
    expect(r.rows[0].n).toBe(4)
  })

  it('seeds 5 Nebras service-desk cases and 4 fraud incidents', async () => {
    const sdc = await admin.query(`SELECT count(*)::int AS n FROM service_desk_case WHERE nebras_case_reference LIKE 'NBR-SD-%'`)
    expect(sdc.rows[0].n).toBe(5)
    const fi = await admin.query(`SELECT count(*)::int AS n FROM fraud_incident WHERE nebras_case_reference LIKE 'NBR-FR-%'`)
    expect(fi.rows[0].n).toBe(4)
  })

  it('links the INC-2026-0042 service-desk case to the break, dispute, and signal', async () => {
    const r = await admin.query(
      `SELECT linked_break_id, linked_dispute_id, linked_signal_id
         FROM service_desk_case WHERE nebras_case_reference = 'NBR-SD-INC-2026-0042'`
    )
    expect(r.rows.length).toBe(1)
    expect(r.rows[0].linked_break_id).not.toBeNull()
    expect(r.rows[0].linked_dispute_id).not.toBeNull()
    expect(r.rows[0].linked_signal_id).not.toBeNull()
  })

  it('threads the INC-2026-0042 token across every console surface', async () => {
    const dispute = await admin.query(`SELECT count(*)::int AS n FROM dispute_case WHERE care_case_id = 'dispute-INC-2026-0042'`)
    const brk = await admin.query(`SELECT count(*)::int AS n FROM reconciliation_break WHERE source_a_ref = 'NBR-INC-2026-0042'`)
    const sig = await admin.query(`SELECT count(*)::int AS n FROM risk_signal WHERE signal_data->>'incident' = 'INC-2026-0042'`)
    const appr = await admin.query(`SELECT count(*)::int AS n FROM approval_request WHERE approval_request_id = 'demo-appr-incident-refund'`)
    expect(dispute.rows[0].n).toBe(1)
    expect(brk.rows[0].n).toBe(1)
    expect(sig.rows[0].n).toBe(1)
    expect(appr.rows[0].n).toBe(1)
  })

  it('is idempotent — re-running the scenario does not duplicate', async () => {
    const before = await admin.query(`SELECT count(*)::int AS n FROM service_desk_case WHERE nebras_case_reference LIKE 'NBR-SD-%'`)
    await seedDemoScenario(url)
    const after = await admin.query(`SELECT count(*)::int AS n FROM service_desk_case WHERE nebras_case_reference LIKE 'NBR-SD-%'`)
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })

  it('stores zero real-PII Emirates-ID shapes in the scenario', async () => {
    const r = await admin.query(`SELECT coalesce(string_agg(summary, ' '), '') AS blob FROM service_desk_case`)
    expect(r.rows[0].blob.replace(/[\s-]/g, '')).not.toMatch(/784\d{12}/)
  })
})
