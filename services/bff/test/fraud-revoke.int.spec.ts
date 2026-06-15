import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgLineageEmitter } from '@ofbo/db'
import { makeFraudRevokeOperation } from '../src/consents/fraud-revoke.js'

/**
 * BACKOFFICE-22 integration: the fraud-revoke operation's High-class audit
 * persists under RLS with reason FRAUD_SUSPECTED, psu_notified=false, the STR
 * draft ref, and the case_context PII redacted at emission — against real
 * Postgres. (The four-eyes HTTP flow is covered by the unit suite.)
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const CONSENT = randomUUID()
const EMIRATES_ID = ['999', '1990', '7654321', '9'].join('-') // synthetic PII shape in the case context

class FakeEgress {
  async revokeConsent() {
    return { acknowledged_in_ms: 420 }
  }
}

describe('fraud revoke — audit persistence + PII redaction', () => {
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

  it('persists a redacted FRAUD_SUSPECTED consent_revoked audit, PSU notification deferred', async () => {
    const trace = randomUUID()
    const op = makeFraudRevokeOperation({ egress: new FakeEgress(), audit })
    const result = (await op.execute({
      consent_id: CONSENT,
      case_context: `fraud ring linked to ${EMIRATES_ID}`,
      initiated_by: 'demo:risk-analyst',
      initiated_by_persona: 'risk-analyst',
      trace_id: trace
    })) as { status: string; psu_notified: boolean; str_draft_ref: string }
    expect(result.status).toBe('Revoked')
    expect(result.psu_notified).toBe(false)
    expect(result.str_draft_ref).toBeTruthy()

    const { rows } = await admin.query(
      `SELECT scope_used, target_consent_id, request_body_redacted FROM audit_high_sensitivity
         WHERE request_trace_id = $1 AND event_type = 'consent_revoked'`,
      [trace]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].scope_used).toBe('consents:admin:fraud-revoke')
    expect(rows[0].target_consent_id).toBe(CONSENT)
    expect(rows[0].request_body_redacted.reason_code).toBe('FRAUD_SUSPECTED')
    expect(rows[0].request_body_redacted.psu_notified).toBe(false)
    // the Emirates ID embedded in the case context is redacted at emission
    expect(JSON.stringify(rows[0].request_body_redacted)).not.toContain(EMIRATES_ID)
    expect(JSON.stringify(rows[0].request_body_redacted)).toContain('[REDACTED:emirates_id]')
  })
})
