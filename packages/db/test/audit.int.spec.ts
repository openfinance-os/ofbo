import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { applyMigrations } from '../src/apply.js'
import { PgAuditEmitter } from '../src/audit.js'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required for integration tests')

const BANK = '11111111-1111-4111-8111-111111111111'
const TRACE = 'audit-int-4000-8000-000000000001'
const EMIRATES_ID = ['784', '1990', '7654321', '9'].join('-') // assembled — see redact.spec.ts

describe('BACKOFFICE-45 — High-class audit write path', () => {
  const admin = new pg.Pool({ connectionString: url })
  let emitter: PgAuditEmitter

  beforeAll(async () => {
    await applyMigrations(url)
    emitter = new PgAuditEmitter(url, { bankId: BANK, channel: 'internal_retail' })
  })
  afterAll(async () => {
    await emitter.close()
    await admin.end()
  })

  it('writes sign-in and scope-denial events from the BFF sink shape', async () => {
    await emitter.record({
      event_type: 'signin_success',
      acting_principal: 'demo:operations-analyst',
      acting_persona: 'operations-analyst',
      reason: null,
      trace_id: TRACE,
      superadmin_marker: false
    })
    await emitter.record({
      event_type: 'scope_denied',
      acting_principal: 'demo:customer-care-agent',
      acting_persona: 'customer-care-agent',
      reason: 'scope_not_held',
      attempted_scope: 'reconciliation:read',
      trace_id: TRACE,
      superadmin_marker: false
    })
    const r = await admin.query(
      `SELECT event_type, acting_persona, scope_used, request_trace_id FROM audit_high_sensitivity WHERE request_trace_id = $1 ORDER BY created_at`,
      [TRACE]
    )
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0].event_type).toBe('signin_success')
    expect(r.rows[1].event_type).toBe('scope_denied')
    expect(r.rows[1].scope_used).toBe('reconciliation:read')
    expect(r.rows[1].request_trace_id).toBe(TRACE)
  })

  it('redacts PII at emission — a PII-shaped body never reaches the table', async () => {
    const trace = `${TRACE}-pii`
    await emitter.emit({
      event_type: 'psu_lookup',
      acting_principal: 'demo:customer-care-agent',
      acting_persona: 'customer-care-agent',
      scope_used: 'consents:admin',
      target_psu_identifier: 'cust-0001',
      request_trace_id: trace,
      request_body: { identifier: EMIRATES_ID, note: 'lookup' },
      response_status: 200
    })
    const r = await admin.query(
      `SELECT request_body_redacted::text AS body FROM audit_high_sensitivity WHERE request_trace_id = $1`,
      [trace]
    )
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].body).not.toContain(EMIRATES_ID)
    expect(r.rows[0].body).toContain('[REDACTED:emirates_id]')
  })

  it('the emitter cannot update or delete what it wrote (INSERT-only holds end-to-end)', async () => {
    await expect(
      emitter.dangerousRawQuery(`UPDATE audit_high_sensitivity SET response_status = 500 WHERE request_trace_id LIKE $1`, [`${TRACE}%`])
    ).rejects.toThrow(/permission denied/)
    await expect(
      emitter.dangerousRawQuery(`DELETE FROM audit_high_sensitivity WHERE request_trace_id LIKE $1`, [`${TRACE}%`])
    ).rejects.toThrow(/permission denied/)
  })
})
