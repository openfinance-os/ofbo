import { describe, expect, it, vi } from 'vitest'
import { createDispute, getPsuAuditTrail, revokeConsent, searchConsents, CareApiError, IDENTIFIER_TYPES, REVOKE_REASON_CODES } from '../src/lib/care.js'

/**
 * UI-02 — BFF client (BACKOFFICE-16/-19/-17/-20). Asserts the contract paths, the
 * Bearer + x-fapi-interaction-id propagation, the Idempotency-Key on every mutation,
 * and the {data}/{error} envelope unwrap. fetch is faked — no running BFF required.
 */

const BASE = 'http://bff.test'
const TOKEN = 'demo-token:customer-care-agent'

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('care client — search (BACKOFFICE-16)', () => {
  it('GETs /consents:search-psu with the identifier params, Bearer token and trace id', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ data: { psu: { bank_customer_id: 'cust-1', account_count: 2 }, consents: [] }, meta: {} }))
    const result = await searchConsents(TOKEN, 'iban', 'AE07 0331 2345 6789', { baseUrl: BASE, fetchImpl, traceId: 'trace-1' })

    expect(result.psu.bank_customer_id).toBe('cust-1')
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(`${BASE}/consents:search-psu?identifier_type=iban&identifier=AE07%200331%202345%206789`)
    expect(init!.headers).toMatchObject({ authorization: `Bearer ${TOKEN}`, 'x-fapi-interaction-id': 'trace-1' })
  })

  it('throws a typed CareApiError carrying the envelope code on a non-2xx', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ error: { code: 'BACKOFFICE.NOT_FOUND', message: 'No PSU' } }, 404))
    await expect(searchConsents(TOKEN, 'bank_customer_id', 'x', { baseUrl: BASE, fetchImpl })).rejects.toMatchObject({
      code: 'BACKOFFICE.NOT_FOUND',
      status: 404
    })
    await expect(searchConsents(TOKEN, 'bank_customer_id', 'x', { baseUrl: BASE, fetchImpl })).rejects.toBeInstanceOf(CareApiError)
  })

  it('exposes the three identifier types as the contract enum', () => {
    expect([...IDENTIFIER_TYPES]).toEqual(['bank_customer_id', 'iban', 'emirates_id'])
  })
})

describe('care client — timeline (BACKOFFICE-19)', () => {
  it('GETs /psu/{id}/audit-trail and returns events + the next_cursor from meta', async () => {
    const events = [{ id: 'e1', consent_id: 'c1', psu_identifier: 'cust-1', event_type: 'granted', event_subtype: null, event_data: {}, acting_principal: 'sys', created_at: '2025-01-01T00:00:00.000Z' }]
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ data: events, meta: { next_cursor: 'CURSOR2' } }))
    const timeline = await getPsuAuditTrail(TOKEN, 'cust-1', { baseUrl: BASE, fetchImpl })

    expect(timeline.events).toHaveLength(1)
    expect(timeline.next_cursor).toBe('CURSOR2')
    expect(fetchImpl.mock.calls[0]![0]).toBe(`${BASE}/psu/cust-1/audit-trail`)
  })

  it('tolerates a missing meta (empty timeline, null cursor)', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ data: [] }))
    const timeline = await getPsuAuditTrail(TOKEN, 'cust-1', { baseUrl: BASE, fetchImpl })
    expect(timeline.events).toEqual([])
    expect(timeline.next_cursor).toBeNull()
  })
})

describe('care client — revoke (BACKOFFICE-17)', () => {
  it('POSTs /consents/{id}:revoke-admin with the reason code and a mandatory Idempotency-Key', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ data: { consent_id: 'c1', status: 'Revoked', nebras_propagation_ms: 1200, psu_notified: true } }))
    const res = await revokeConsent(TOKEN, 'c1', 'TPP_REQUEST', 'idem-1', { baseUrl: BASE, fetchImpl })

    expect(res.status).toBe('Revoked')
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(`${BASE}/consents/c1:revoke-admin`)
    expect(init!.method).toBe('POST')
    expect(init!.headers).toMatchObject({ authorization: `Bearer ${TOKEN}`, 'idempotency-key': 'idem-1' })
    expect(JSON.parse(init!.body as string)).toEqual({ reason_code: 'TPP_REQUEST' })
  })

  it('exposes the three admin reason codes (FRAUD_SUSPECTED excluded — Risk-only)', () => {
    expect([...REVOKE_REASON_CODES]).toEqual(['TPP_REQUEST', 'CLIENT_INSTRUCTION', 'REGULATORY'])
    expect([...REVOKE_REASON_CODES]).not.toContain('FRAUD_SUSPECTED')
  })
})

describe('care client — dispute (BACKOFFICE-20)', () => {
  it('POSTs /disputes with the dispute body and an Idempotency-Key', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ data: { id: 'd1', state: 'open', dispute_type: 'unauthorised_payment', originating_payment_id: 'PIS-1' } }, 201))
    const res = await createDispute(TOKEN, { psu_identifier: 'cust-1', dispute_type: 'unauthorised_payment', originating_payment_id: 'PIS-1' }, 'idem-2', { baseUrl: BASE, fetchImpl })

    expect(res.id).toBe('d1')
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(`${BASE}/disputes`)
    expect(init!.method).toBe('POST')
    expect(init!.headers).toMatchObject({ 'idempotency-key': 'idem-2' })
    expect(JSON.parse(init!.body as string)).toMatchObject({ psu_identifier: 'cust-1', dispute_type: 'unauthorised_payment' })
  })
})
