import { describe, expect, it } from 'vitest'
import type { TraceContext } from '@ofbo/ports'
import { createApp } from '../src/app.js'
import { DemoConsentDirectory, RevocableConsentDirectory } from '../src/consents/directory.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * DEMO fidelity — a consent revoke reflects on re-lookup within the running process
 * (the in-process MCP demo / local dev), WITHOUT mutating the shared synthetic seed
 * (so each createApp / test stays isolated). Covers the QA gap: revoke → re-read shows
 * Revoked.
 */

class FakeEgress {
  async revokeConsent(_id: string, _reason: string, _t: TraceContext) {
    return { acknowledged_in_ms: 420 }
  }
  async createDisputeCase() {
    return { nebras_case_id: 'unused' }
  }
  async dispatchRefund() {
    return { ipp_status: 'ACSP' }
  }
}

const care = (extra: Record<string, string> = {}) => ({
  ...FAPI_HEADERS,
  authorization: 'Bearer demo-token:customer-care-agent',
  'content-type': 'application/json',
  ...extra
})

describe('RevocableConsentDirectory overlay', () => {
  it('overrides status to Revoked on getByConsentId + search without mutating the base seed', () => {
    const base = new DemoConsentDirectory()
    // find a real consent id from the seed
    const psu = base.search('bank_customer_id', 'cust-0001')!
    const target = psu.consents[0]!
    const originalStatus = target.status

    const overlay = new RevocableConsentDirectory(base)
    overlay.markRevoked(target.consent_id)

    expect(overlay.getByConsentId(target.consent_id)!.status).toBe('Revoked')
    expect(overlay.search('bank_customer_id', 'cust-0001')!.consents.find((c) => c.consent_id === target.consent_id)!.status).toBe('Revoked')
    // the shared seed is untouched (a fresh overlay sees the original status)
    expect(base.getByConsentId(target.consent_id)!.status).toBe(originalStatus)
    expect(new RevocableConsentDirectory(base).getByConsentId(target.consent_id)!.status).toBe(originalStatus)
  })

  it('isolates overlays per instance (one revoke does not leak to another)', () => {
    const base = new DemoConsentDirectory()
    const id = base.search('bank_customer_id', 'cust-0001')!.consents[0]!.consent_id
    const a = new RevocableConsentDirectory(base)
    const b = new RevocableConsentDirectory(base)
    a.markRevoked(id)
    expect(a.getByConsentId(id)!.status).toBe('Revoked')
    expect(b.getByConsentId(id)!.status).not.toBe('Revoked')
  })
})

describe('consent revoke reflects on re-lookup (end to end through the app)', () => {
  it('admin-view + search show Revoked after a single revoke-admin', async () => {
    const app = createApp({ nebrasEgress: new FakeEgress() })

    // Find a revocable consent for a seeded demo PSU.
    const searchRes = await app.request('/consents:search-psu?identifier_type=bank_customer_id&identifier=cust-0001', { headers: care() })
    expect(searchRes.status).toBe(200)
    const { data } = (await searchRes.json()) as { data: { consents: Array<{ consent_id: string; status: string }> } }
    const target = data.consents.find((c) => c.status === 'Authorized' || c.status === 'Suspended') ?? data.consents[0]!

    // Revoke it.
    const revoke = await app.request(`/consents/${target.consent_id}:revoke-admin`, {
      method: 'POST',
      headers: care({ 'idempotency-key': 'fidelity-1' }),
      body: JSON.stringify({ reason_code: 'TPP_REQUEST' })
    })
    expect(revoke.status).toBe(200)

    // Re-read the admin view: now reflects Revoked (was the QA gap).
    const admin = await app.request(`/consents/${target.consent_id}:admin`, { headers: care() })
    expect(admin.status).toBe(200)
    expect(((await admin.json()) as { data: { status: string } }).data.status).toBe('Revoked')

    // And the PSU search reflects it too.
    const reSearch = await app.request('/consents:search-psu?identifier_type=bank_customer_id&identifier=cust-0001', { headers: care() })
    const after = (await reSearch.json()) as { data: { consents: Array<{ consent_id: string; status: string }> } }
    expect(after.data.consents.find((c) => c.consent_id === target.consent_id)!.status).toBe('Revoked')
  })

  it('does not leak across app instances (fresh createApp sees the original status)', async () => {
    const app1 = createApp({ nebrasEgress: new FakeEgress() })
    const search = await app1.request('/consents:search-psu?identifier_type=bank_customer_id&identifier=cust-0002', { headers: care() })
    const { data } = (await search.json()) as { data: { consents: Array<{ consent_id: string; status: string }> } }
    const target = data.consents.find((c) => c.status === 'Authorized' || c.status === 'Suspended') ?? data.consents[0]!
    await app1.request(`/consents/${target.consent_id}:revoke-admin`, {
      method: 'POST',
      headers: care({ 'idempotency-key': 'fidelity-2' }),
      body: JSON.stringify({ reason_code: 'TPP_REQUEST' })
    })

    const app2 = createApp({ nebrasEgress: new FakeEgress() })
    const admin = await app2.request(`/consents/${target.consent_id}:admin`, { headers: care() })
    expect(((await admin.json()) as { data: { status: string } }).data.status).not.toBe('Revoked')
  })
})
