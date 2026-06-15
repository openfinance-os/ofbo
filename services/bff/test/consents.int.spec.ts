import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgLineageEmitter } from '@ofbo/db'
import { generateDemoDataset } from '@ofbo/synthetic-data'
import { createApp } from '../src/app.js'

/**
 * BACKOFFICE-16 integration: a PSU consent search by Emirates ID writes exactly
 * one High-class audit row whose body has the PII identifier REDACTED at
 * emission, keyed to the resolved internal id — proven against real Postgres
 * under RLS (the audit emitter sets the tenancy role per statement).
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const psu = generateDemoDataset().psus[0]!

describe('PSU consent search — audit persistence + PII redaction', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(url!)
  })
  afterAll(async () => {
    await audit.close()
    await lineage.close()
    await admin.end()
  })

  it('persists a redacted consent_search audit row for an Emirates-ID search', async () => {
    const trace = `consent-search-int-${randomUUID()}`
    const app = createApp({ audit })
    const res = await app.request(
      `/consents:search-psu?identifier_type=emirates_id&identifier=${encodeURIComponent(psu.emirates_id)}`,
      {
        headers: {
          'x-fapi-interaction-id': trace,
          authorization: 'Bearer demo-token:customer-care-agent'
        }
      }
    )
    expect(res.status).toBe(200)

    // The auth middleware also writes a signin_success row on this trace; scope
    // the assertion to the search event — there must be exactly one.
    const { rows } = await admin.query(
      `SELECT event_type, acting_persona, scope_used, target_psu_identifier, request_body_redacted, response_status
         FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'consent_search'`,
      [trace]
    )
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.event_type).toBe('consent_search')
    expect(row.acting_persona).toBe('customer-care-agent')
    expect(row.scope_used).toBe('consents:admin')
    expect(row.target_psu_identifier).toBe(psu.bank_customer_id)
    expect(row.response_status).toBe(200)
    // The raw Emirates ID (PII) is redacted; identifier_type stays in the clear.
    expect(row.request_body_redacted.identifier).toBe('[REDACTED:emirates_id]')
    expect(row.request_body_redacted.identifier_type).toBe('emirates_id')
    expect(JSON.stringify(row.request_body_redacted)).not.toContain(psu.emirates_id)
  })
})
