import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-22 — fraud-suspected revocation. Narrow Risk scope
 * (consents:admin:fraud-revoke), four-eyes-gated. On approval: P6 revoke with
 * FRAUD_SUSPECTED, STR draft auto-created, Compliance notified via the audit
 * trail, PSU notification deferred. The demo subject is per-persona, so the
 * approver is the super-admin (distinct subject, holds fraud-revoke via union).
 */

const CONSENT = '22222222-2222-4222-8222-222222222222'

class FakeEgress {
  revokeCalls: Array<{ consentId: string; reason: string }> = []
  async revokeConsent(consentId: string, reason: string) {
    this.revokeCalls.push({ consentId, reason })
    return { acknowledged_in_ms: 420 }
  }
  async createDisputeCase() {
    return { nebras_case_id: 'n' }
  }
  async dispatchRefund() {
    return { ipp_status: 'ACSP' }
  }
}

const risk = (extra: Record<string, string> = {}) => ({
  ...FAPI_HEADERS,
  authorization: 'Bearer demo-token:risk-analyst',
  'content-type': 'application/json',
  ...extra
})
const superAdmin = (extra: Record<string, string> = {}) => ({
  ...FAPI_HEADERS,
  authorization: 'Bearer demo-token:platform-super-admin',
  'x-superadmin-justification': 'four-eyes approval of a fraud-suspected revocation (test)',
  'content-type': 'application/json',
  ...extra
})

function appWith() {
  const audit = new InMemoryHighClassAuditSink()
  const egress = new FakeEgress()
  return { app: createApp({ nebrasEgress: egress, highClassAudit: audit }), audit, egress }
}

const body = () => JSON.stringify({ case_context: 'unusual cross-border AISP access pattern flagged by monitoring' })

describe('POST /consents/{consent_id}:revoke-fraud', () => {
  it('is four-eyes-gated: 202 + pending approval, no inline revoke', async () => {
    const { app, egress } = appWith()
    const res = await app.request(`/consents/${CONSENT}:revoke-fraud`, { method: 'POST', headers: risk({ 'idempotency-key': 'f1' }), body: body() })
    expect(res.status).toBe(202)
    const ar = (await res.json()) as { data: { state: string; operation_type: string } }
    expect(ar.data.state).toBe('pending')
    expect(ar.data.operation_type).toBe('consents.fraud_revoke')
    expect(egress.revokeCalls).toHaveLength(0) // nothing revoked inline
  })

  it('executes only on a different principal’s approval: P6 revoke FRAUD_SUSPECTED, STR draft, PSU deferred', async () => {
    const { app, audit, egress } = appWith()
    const init = await app.request(`/consents/${CONSENT}:revoke-fraud`, { method: 'POST', headers: risk({ 'idempotency-key': 'f2' }), body: body() })
    const approvalId = ((await init.json()) as { data: { approval_request_id: string } }).data.approval_request_id

    // self-approval rejected (four-eyes)
    const self = await app.request(`/approvals/${approvalId}:approve`, { method: 'POST', headers: risk({ 'idempotency-key': 'fa-self' }) })
    expect(self.status).toBe(409)

    const ok = await app.request(`/approvals/${approvalId}:approve`, { method: 'POST', headers: superAdmin({ 'idempotency-key': 'fa-ok' }) })
    expect(ok.status).toBe(200)
    const exec = ((await ok.json()) as { data: { execution_result?: { status?: string; psu_notified?: boolean; str_draft_ref?: string } } }).data.execution_result
    expect(exec?.status).toBe('Revoked')
    expect(exec?.psu_notified).toBe(false) // deferred per fraud policy
    expect(exec?.str_draft_ref).toBeTruthy()

    expect(egress.revokeCalls).toEqual([{ consentId: CONSENT, reason: 'FRAUD_SUSPECTED' }])
    const ev = audit.events.find((e) => e.event_type === 'consent_revoked' && e.target_consent_id === CONSENT)
    expect(ev?.scope_used).toBe('consents:admin:fraud-revoke')
    expect((ev?.request_body as { reason_code: string; psu_notified: boolean }).reason_code).toBe('FRAUD_SUSPECTED')
    expect((ev?.request_body as { psu_notified: boolean }).psu_notified).toBe(false)
  })

  it('400 on missing case_context; 400 without Idempotency-Key', async () => {
    const { app } = appWith()
    expect((await app.request(`/consents/${CONSENT}:revoke-fraud`, { method: 'POST', headers: risk({ 'idempotency-key': 'f3' }), body: JSON.stringify({}) })).status).toBe(400)
    expect((await app.request(`/consents/${CONSENT}:revoke-fraud`, { method: 'POST', headers: risk(), body: body() })).status).toBe(400)
  })

  it('rejects a persona without the narrow fraud-revoke scope (403) — Customer Care has consents:admin but not :fraud-revoke', async () => {
    const { app, egress } = appWith()
    const res = await app.request(`/consents/${CONSENT}:revoke-fraud`, {
      method: 'POST',
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:customer-care-agent', 'content-type': 'application/json', 'idempotency-key': 'f4' },
      body: body()
    })
    expect(res.status).toBe(403)
    expect(egress.revokeCalls).toHaveLength(0)
  })
})
