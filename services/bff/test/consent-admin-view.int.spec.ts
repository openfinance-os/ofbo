import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgLineageEmitter } from '@ofbo/db'
import { generateDemoDataset } from '@ofbo/synthetic-data'
import { createApp } from '../src/app.js'
import { DemoConsentDirectory } from '../src/consents/directory.js'

/**
 * BACKOFFICE-61 — the consent :admin view's one audit-relevant op (consent_admin_view)
 * persists to audit_high_sensitivity over real Postgres (INSERT-only, RLS via ofbo_app).
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const paymentConsent = generateDemoDataset().psus.flatMap((p) => p.consents).find((c) => c.purpose === 'SIP_PAYMENT')!

describe('consent :admin view — audit persistence', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)
  const app = createApp({ audit, consentDirectory: new DemoConsentDirectory() })

  beforeAll(async () => {
    await applyMigrations(url!)
  }, 60_000)
  afterAll(async () => {
    await audit.close()
    await lineage.close()
    await admin.end()
  })

  it('writes one consent_admin_view audit keyed by the consent id', async () => {
    const trace = randomUUID()
    const res = await app.request(`/consents/${paymentConsent.consent_id}:admin`, {
      headers: { 'x-fapi-interaction-id': trace, authorization: 'Bearer demo-token:customer-care-agent' }
    })
    expect(res.status).toBe(200)

    const row = await admin.query(
      `SELECT target_consent_id FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'consent_admin_view'`,
      [trace]
    )
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0].target_consent_id).toBe(paymentConsent.consent_id)
  }, 60_000)
})
