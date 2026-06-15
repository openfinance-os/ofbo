import { describe, expect, it } from 'vitest'
import { generateDemoDataset } from '@ofbo/synthetic-data'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-18 — emergency PSU-wide bulk revocation. consents:admin,
 * four-eyes (202 + approval, never inline). On a different principal's approval:
 * ALL active consents (Authorized/Suspended) revoked in parallel through P6,
 * a single grouped audit record carrying every revocation id, and one
 * consolidated PSU notification.
 */

// PSU1 in the deterministic demo set has 2 active consents (1 Authorized +
// 1 Suspended) — the strongest happy-path assertion for a grouped revoke.
const dataset = generateDemoDataset()
const PSU = dataset.psus[1]!
const ACTIVE = new Set(['Authorized', 'Suspended'])
const activeConsentIds = PSU.consents.filter((c) => ACTIVE.has(c.status)).map((c) => c.consent_id).sort()
// PSU3 has zero active consents — the empty-sweep edge case.
const EMPTY_PSU = dataset.psus[3]!

class FakeEgress {
  revokeCalls: Array<{ consentId: string; reason: string }> = []
  async revokeConsent(consentId: string, reason: string) {
    this.revokeCalls.push({ consentId, reason })
    return { acknowledged_in_ms: 380 }
  }
  async createDisputeCase() {
    return { nebras_case_id: 'n' }
  }
  async dispatchRefund() {
    return { ipp_status: 'ACSP' as const }
  }
}

const care = (extra: Record<string, string> = {}) => ({
  ...FAPI_HEADERS,
  authorization: 'Bearer demo-token:customer-care-agent',
  'content-type': 'application/json',
  ...extra
})
const superAdmin = (extra: Record<string, string> = {}) => ({
  ...FAPI_HEADERS,
  authorization: 'Bearer demo-token:platform-super-admin',
  'x-superadmin-justification': 'four-eyes approval of an emergency PSU-wide bulk revocation (test)',
  'content-type': 'application/json',
  ...extra
})

function appWith() {
  const audit = new InMemoryHighClassAuditSink()
  const egress = new FakeEgress()
  return { app: createApp({ nebrasEgress: egress, highClassAudit: audit }), audit, egress }
}

const body = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ psu_identifier_type: 'bank_customer_id', psu_identifier: PSU.bank_customer_id, reason_code: 'CLIENT_INSTRUCTION', ...over })

describe('POST /consents:revoke-bulk', () => {
  it('is four-eyes-gated: 202 + pending approval, nothing revoked inline', async () => {
    const { app, egress } = appWith()
    const res = await app.request('/consents:revoke-bulk', { method: 'POST', headers: care({ 'idempotency-key': 'b1' }), body: body() })
    expect(res.status).toBe(202)
    const ar = (await res.json()) as { data: { state: string; operation_type: string } }
    expect(ar.data.state).toBe('pending')
    expect(ar.data.operation_type).toBe('consents.bulk_revoke')
    expect(egress.revokeCalls).toHaveLength(0)
  })

  it('on a different principal’s approval: revokes ALL active consents in parallel + one grouped audit', async () => {
    const { app, audit, egress } = appWith()
    const init = await app.request('/consents:revoke-bulk', { method: 'POST', headers: care({ 'idempotency-key': 'b2' }), body: body() })
    const approvalId = ((await init.json()) as { data: { approval_request_id: string } }).data.approval_request_id

    // self-approval rejected (four-eyes) — initiator ≠ approver, even super-admin
    const self = await app.request(`/approvals/${approvalId}:approve`, { method: 'POST', headers: care({ 'idempotency-key': 'ba-self' }) })
    expect(self.status).toBe(409)

    const ok = await app.request(`/approvals/${approvalId}:approve`, { method: 'POST', headers: superAdmin({ 'idempotency-key': 'ba-ok' }) })
    expect(ok.status).toBe(200)
    const exec = ((await ok.json()) as {
      data: { execution_result?: { status?: string; revoked_count?: number; consent_ids?: string[]; sla_met?: boolean; psu_notified?: boolean } }
    }).data.execution_result
    expect(exec?.status).toBe('Revoked')
    expect(exec?.revoked_count).toBe(activeConsentIds.length)
    expect(exec?.consent_ids?.slice().sort()).toEqual(activeConsentIds)
    expect(exec?.sla_met).toBe(true)
    expect(exec?.psu_notified).toBe(true) // single consolidated notification

    // every active consent revoked through P6 with the bulk reason; none of the others
    expect(egress.revokeCalls.map((r) => r.consentId).sort()).toEqual(activeConsentIds)
    expect(egress.revokeCalls.every((r) => r.reason === 'CLIENT_INSTRUCTION')).toBe(true)

    // exactly ONE grouped audit record with all revocation ids
    const grouped = audit.events.filter((e) => e.event_type === 'consents_bulk_revoked')
    expect(grouped).toHaveLength(1)
    const rb = grouped[0]!.request_body as { consent_ids: string[]; revoked_count: number; psu_notified: boolean; sla_met: boolean }
    expect(rb.consent_ids.slice().sort()).toEqual(activeConsentIds)
    expect(rb.revoked_count).toBe(activeConsentIds.length)
    expect(rb.psu_notified).toBe(true)
    expect(grouped[0]!.target_psu_identifier).toBe(PSU.bank_customer_id)
  })

  it('resolves the PSU by emirates_id and never persists the raw Emirates ID in the approval payload', async () => {
    const { app } = appWith()
    const init = await app.request('/consents:revoke-bulk', {
      method: 'POST',
      headers: care({ 'idempotency-key': 'b3' }),
      body: body({ psu_identifier_type: 'emirates_id', psu_identifier: PSU.emirates_id })
    })
    expect(init.status).toBe(202)
    // the wire never exposes the operation payload (toWire strips it)
    expect(JSON.stringify(await init.json())).not.toContain(PSU.emirates_id)
  })

  it('an empty sweep (PSU with no active consents) succeeds with revoked_count 0', async () => {
    const { app, egress } = appWith()
    const init = await app.request('/consents:revoke-bulk', {
      method: 'POST',
      headers: care({ 'idempotency-key': 'b4' }),
      body: body({ psu_identifier: EMPTY_PSU.bank_customer_id })
    })
    const approvalId = ((await init.json()) as { data: { approval_request_id: string } }).data.approval_request_id
    const ok = await app.request(`/approvals/${approvalId}:approve`, { method: 'POST', headers: superAdmin({ 'idempotency-key': 'ba-empty' }) })
    expect(ok.status).toBe(200)
    const exec = ((await ok.json()) as { data: { execution_result?: { revoked_count?: number } } }).data.execution_result
    expect(exec?.revoked_count).toBe(0)
    expect(egress.revokeCalls).toHaveLength(0)
  })

  it('replays the same Idempotency-Key (no duplicate approval); a different PSU is not shadowed by it', async () => {
    const { app } = appWith()
    const first = await app.request('/consents:revoke-bulk', { method: 'POST', headers: care({ 'idempotency-key': 'dup' }), body: body() })
    const a1 = ((await first.json()) as { data: { approval_request_id: string } }).data.approval_request_id
    const replay = await app.request('/consents:revoke-bulk', { method: 'POST', headers: care({ 'idempotency-key': 'dup' }), body: body() })
    const a2 = ((await replay.json()) as { data: { approval_request_id: string } }).data.approval_request_id
    expect(a2).toBe(a1) // same key + same PSU ⇒ original approval replayed
    // same key, DIFFERENT PSU ⇒ must NOT replay the first (would silently skip the second sweep)
    const other = await app.request('/consents:revoke-bulk', { method: 'POST', headers: care({ 'idempotency-key': 'dup' }), body: body({ psu_identifier: EMPTY_PSU.bank_customer_id }) })
    const a3 = ((await other.json()) as { data: { approval_request_id: string } }).data.approval_request_id
    expect(a3).not.toBe(a1)
  })

  it('400 missing fields / invalid reason_code; 404 unknown PSU; 400 without Idempotency-Key', async () => {
    const { app } = appWith()
    expect((await app.request('/consents:revoke-bulk', { method: 'POST', headers: care({ 'idempotency-key': 'e1' }), body: JSON.stringify({}) })).status).toBe(400)
    expect((await app.request('/consents:revoke-bulk', { method: 'POST', headers: care({ 'idempotency-key': 'e2' }), body: body({ reason_code: 'FRAUD_SUSPECTED' }) })).status).toBe(400)
    expect((await app.request('/consents:revoke-bulk', { method: 'POST', headers: care({ 'idempotency-key': 'e3' }), body: body({ psu_identifier: 'cust-9999' }) })).status).toBe(404)
    expect((await app.request('/consents:revoke-bulk', { method: 'POST', headers: care(), body: body() })).status).toBe(400)
  })

  it('rejects a persona without consents:admin (403) — Risk Analyst holds only the narrow :fraud-revoke', async () => {
    const { app, egress } = appWith()
    const res = await app.request('/consents:revoke-bulk', {
      method: 'POST',
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:risk-analyst', 'content-type': 'application/json', 'idempotency-key': 'e4' },
      body: body()
    })
    expect(res.status).toBe(403)
    expect(egress.revokeCalls).toHaveLength(0)
  })
})
