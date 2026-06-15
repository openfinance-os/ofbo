import { describe, expect, it } from 'vitest'
import { generateDemoDataset } from '@ofbo/synthetic-data'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-16 — PSU-centric consent search. Contract + acceptance tests:
 * envelope shape, the three identifier types, full lifecycle status, exactly one
 * High-class audit per call with the agent identity (resolved internal id, never
 * raw PII), scope enforced at the BFF layer, and the not-found path.
 */

const ds = generateDemoDataset()
const psu = ds.psus[0]! // cust-0001
const care = (h: Record<string, string> = {}) => ({
  ...FAPI_HEADERS,
  authorization: 'Bearer demo-token:customer-care-agent',
  ...h
})

function appWith() {
  const audit = new InMemoryHighClassAuditSink()
  return { app: createApp({ highClassAudit: audit }), audit }
}

describe('GET /consents:search-psu', () => {
  it('returns the PSU + consents envelope for a bank_customer_id', async () => {
    const { app } = appWith()
    const res = await app.request(
      `/consents:search-psu?identifier_type=bank_customer_id&identifier=${psu.bank_customer_id}`,
      { headers: care() }
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { psu: { bank_customer_id: string; account_count: number }; consents: unknown[] }
      meta: { request_id: string; timestamp: string }
    }
    expect(body.data.psu.bank_customer_id).toBe(psu.bank_customer_id)
    expect(body.data.psu.account_count).toBe(psu.accounts.length)
    expect(body.data.consents.length).toBe(psu.consents.length)
    expect(body.meta.request_id).toBeTruthy()
  })

  it('each consent carries TPP identity, purpose, scope, lifecycle status, last access', async () => {
    const { app } = appWith()
    const res = await app.request(
      `/consents:search-psu?identifier_type=bank_customer_id&identifier=${psu.bank_customer_id}`,
      { headers: care() }
    )
    const body = (await res.json()) as { data: { consents: Record<string, unknown>[] } }
    const c = body.data.consents[0] as {
      consent_id: string
      tpp: { client_id: string; display_name: string }
      purpose: string
      scope: string[]
      status: string
      granted_at: string
      last_access_at: string | null
    }
    expect(c.consent_id).toBeTruthy()
    expect(c.tpp.client_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(c.tpp.display_name).toBeTruthy()
    expect(Array.isArray(c.scope)).toBe(true)
    expect(
      ['AwaitingAuthorization', 'Authorized', 'Rejected', 'Suspended', 'Consumed', 'Expired', 'Revoked']
    ).toContain(c.status)
  })

  it('resolves the same PSU by emirates_id and by iban', async () => {
    const { app } = appWith()
    const byEid = await app.request(
      `/consents:search-psu?identifier_type=emirates_id&identifier=${encodeURIComponent(psu.emirates_id)}`,
      { headers: care() }
    )
    const byIban = await app.request(
      `/consents:search-psu?identifier_type=iban&identifier=${psu.accounts[0]!.iban}`,
      { headers: care() }
    )
    expect(byEid.status).toBe(200)
    expect(byIban.status).toBe(200)
    type SearchBody = { data: { psu: { bank_customer_id: string } } }
    expect(((await byEid.json()) as SearchBody).data.psu.bank_customer_id).toBe(psu.bank_customer_id)
    expect(((await byIban.json()) as SearchBody).data.psu.bank_customer_id).toBe(psu.bank_customer_id)
  })

  it('writes exactly one High-class audit per search, keyed to the resolved internal id', async () => {
    const { app, audit } = appWith()
    await app.request(
      `/consents:search-psu?identifier_type=emirates_id&identifier=${encodeURIComponent(psu.emirates_id)}`,
      { headers: care() }
    )
    expect(audit.events).toHaveLength(1)
    const e = audit.events[0]!
    expect(e.event_type).toBe('consent_search')
    expect(e.acting_persona).toBe('customer-care-agent')
    expect(e.scope_used).toBe('consents:admin')
    expect(e.target_psu_identifier).toBe(psu.bank_customer_id) // internal id, not raw emirates_id
    expect(e.request_trace_id).toBe(FAPI_HEADERS['x-fapi-interaction-id'])
    expect(e.response_status).toBe(200)
  })

  it('400s on a missing or invalid identifier_type', async () => {
    const { app } = appWith()
    const missing = await app.request(`/consents:search-psu?identifier=x`, { headers: care() })
    expect(missing.status).toBe(400)
    const invalid = await app.request(`/consents:search-psu?identifier_type=passport&identifier=x`, { headers: care() })
    expect(invalid.status).toBe(400)
    expect(((await invalid.json()) as { error: { code: string } }).error.code).toMatch(/IDENTIFIER/)
  })

  it('404s on an unknown identifier and still audits the attempt', async () => {
    const { app, audit } = appWith()
    const res = await app.request(`/consents:search-psu?identifier_type=bank_customer_id&identifier=cust-9999`, {
      headers: care()
    })
    expect(res.status).toBe(404)
    expect(audit.events).toHaveLength(1)
    expect(audit.events[0]!.response_status).toBe(404)
    expect(audit.events[0]!.target_psu_identifier).toBeNull()
  })

  it('rejects a persona without consents:admin at the BFF layer (403), no consent_search audit', async () => {
    const { app, audit } = appWith()
    const res = await app.request(
      `/consents:search-psu?identifier_type=bank_customer_id&identifier=${psu.bank_customer_id}`,
      { headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst' } }
    )
    expect(res.status).toBe(403)
    expect(audit.events.filter((e) => e.event_type === 'consent_search')).toHaveLength(0)
  })
})
