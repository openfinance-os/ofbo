import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { applyMigrations } from '../src/apply.js'
import { PgAuditEmitter } from '../src/audit.js'
import { PgRiskSignalEmitter } from '../src/risk-signal.js'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required for integration tests')

const BANK = '11111111-1111-4111-8111-111111111111'
const TRACE = `sa-int-${crypto.randomUUID()}` // unique per run: audit is INSERT-only by design

describe('BACKOFFICE-80 — marker column, review view, risk-signal emitter', () => {
  const admin = new pg.Pool({ connectionString: url })
  let audit: PgAuditEmitter
  let risk: PgRiskSignalEmitter

  beforeAll(async () => {
    await applyMigrations(url)
    audit = new PgAuditEmitter(url, { bankId: BANK, channel: 'internal_retail' })
    risk = new PgRiskSignalEmitter(url, { bankId: BANK, channel: 'internal_retail' })
  })
  afterAll(async () => {
    await audit.close()
    await risk.close()
    await admin.end()
  })

  it('persists the superadmin marker as a first-class column', async () => {
    await audit.record({
      event_type: 'superadmin_mutation',
      acting_principal: 'demo:platform-super-admin',
      acting_persona: 'platform-super-admin',
      reason: null,
      trace_id: TRACE,
      superadmin_marker: true,
      justification: 'incident recovery on the reconciliation engine'
    })
    const r = await admin.query(
      `SELECT superadmin_marker, request_body_redacted->>'justification' AS justification
       FROM audit_high_sensitivity WHERE request_trace_id = $1`,
      [TRACE]
    )
    expect(r.rows[0].superadmin_marker).toBe(true)
    expect(r.rows[0].justification).toContain('incident recovery')
  })

  it('the monthly Compliance review view surfaces super-admin activity', async () => {
    const r = await admin.query(
      `SELECT month, acting_principal, event_type, event_count::int AS n
       FROM superadmin_activity_review WHERE acting_principal = 'demo:platform-super-admin'`
    )
    expect(r.rows.length).toBeGreaterThan(0)
    expect(r.rows[0].n).toBeGreaterThan(0)
  })

  it('writes risk signals under the constrained role (RLS binds)', async () => {
    await risk.record({
      signal_type: 'agent_anomaly',
      severity: 'info',
      acting_principal: 'demo:platform-super-admin',
      summary: 'super-admin session active',
      trace_id: TRACE
    })
    const r = await admin.query(
      `SELECT signal_type, severity, status FROM risk_signal WHERE signal_data->>'trace_id' = $1`,
      [TRACE]
    )
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ signal_type: 'agent_anomaly', severity: 'info', status: 'open' })
  })
})
