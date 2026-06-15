import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgLineageEmitter } from '@ofbo/db'
import { createApp } from '../src/app.js'

/**
 * BACKOFFICE-17 integration: a revoke writes exactly one High-class
 * consent_revoked audit row (RLS-bound) carrying the reason code and the Nebras
 * propagation time. Egress goes through the P6 sim adapter (deterministic ack;
 * no NEBRAS_SIM_URL in CI). The reader-side INSERT-only guarantee is untouched.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const CONSENT = randomUUID()

describe('consent revoke — audit persistence', () => {
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

  it('persists a consent_revoked audit row with the reason code and propagation time', async () => {
    const trace = randomUUID()
    const app = createApp({ audit }) // egress defaults to the P6 sim adapter
    const res = await app.request(`/consents/${CONSENT}:revoke-admin`, {
      method: 'POST',
      headers: {
        'x-fapi-interaction-id': trace,
        authorization: 'Bearer demo-token:customer-care-agent',
        'content-type': 'application/json',
        'idempotency-key': randomUUID()
      },
      body: JSON.stringify({ reason_code: 'CLIENT_INSTRUCTION' })
    })
    expect(res.status).toBe(200)
    const data = ((await res.json()) as { data: { status: string; nebras_propagation_ms: number } }).data
    expect(data.status).toBe('Revoked')
    expect(data.nebras_propagation_ms).toBeLessThan(5000)

    const { rows } = await admin.query(
      `SELECT target_consent_id, scope_used, request_body_redacted, response_status
         FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'consent_revoked'`,
      [trace]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].target_consent_id).toBe(CONSENT)
    expect(rows[0].scope_used).toBe('consents:admin')
    expect(rows[0].request_body_redacted.reason_code).toBe('CLIENT_INSTRUCTION')
    expect(rows[0].request_body_redacted.sla_met).toBe(true)
    expect(rows[0].response_status).toBe(200)
  })
})
