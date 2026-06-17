import { describe, expect, it, vi } from 'vitest'
import { createInvoiceRun, formatMoney, listCounterparties, listInvoiceRuns, registerFinancialSystem, syncDirectory, REGISTERABLE_STATES, TppBillingApiError } from '../src/lib/tpp-billing.js'

/**
 * UI-08 — TPP Billing & Registry client (BACKOFFICE-71/-72/-73). Asserts the contract
 * paths, Bearer + x-fapi-interaction-id propagation, the Idempotency-Key on every mutation,
 * and the {data}/{error} envelope. fetch faked — no running BFF.
 */

const BASE = 'http://bff.test'
const TOKEN = 'demo-token:finance-analyst'

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('tpp-billing client — registry (BACKOFFICE-71)', () => {
  it('GETs /tpp-counterparties, returns rows + next_cursor, propagates Bearer + trace', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ data: [{ organisation_id: 'org-1', legal_name: 'Acme' }], meta: { next_cursor: 'C2' } }))
    const out = await listCounterparties(TOKEN, { limit: 50, unbilled_traffic: true }, { baseUrl: BASE, fetchImpl, traceId: 't1' })
    expect(out.counterparties).toHaveLength(1)
    expect(out.next_cursor).toBe('C2')
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(`${BASE}/back-office/tpp-counterparties?limit=50&unbilled_traffic=true`)
    expect(init!.headers).toMatchObject({ authorization: `Bearer ${TOKEN}`, 'x-fapi-interaction-id': 't1' })
  })

  it('maps a non-2xx to a typed TppBillingApiError', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ error: { code: 'BACKOFFICE.SCOPE_DENIED', message: 'no' } }, 403))
    await expect(listCounterparties(TOKEN, {}, { baseUrl: BASE, fetchImpl })).rejects.toBeInstanceOf(TppBillingApiError)
    await expect(listCounterparties(TOKEN, {}, { baseUrl: BASE, fetchImpl })).rejects.toMatchObject({ code: 'BACKOFFICE.SCOPE_DENIED', status: 403 })
  })
})

describe('tpp-billing client — invoice runs (BACKOFFICE-73)', () => {
  it('GETs /invoice-runs', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ data: [{ invoice_run_id: 'inv-1', billing_period: '2026-06' }], meta: {} }))
    const out = await listInvoiceRuns(TOKEN, { limit: 20 }, { baseUrl: BASE, fetchImpl })
    expect(out.runs[0]!.invoice_run_id).toBe('inv-1')
    expect(fetchImpl.mock.calls[0]![0]).toBe(`${BASE}/back-office/invoice-runs?limit=20`)
  })
})

describe('tpp-billing client — mutations', () => {
  it('POSTs :sync-directory with a mandatory Idempotency-Key (BACKOFFICE-71)', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ data: { synced_count: 4 } }, 202))
    const out = await syncDirectory(TOKEN, 'idem-1', { baseUrl: BASE, fetchImpl })
    expect(out.synced_count).toBe(4)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(`${BASE}/back-office/tpp-counterparties:sync-directory`)
    expect(init!.method).toBe('POST')
    expect(init!.headers).toMatchObject({ 'idempotency-key': 'idem-1' })
  })

  it('POSTs :register-financial-system for an org with an Idempotency-Key (BACKOFFICE-72)', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ data: { organisation_id: 'org-1', registration_state: 'registered' } }, 202))
    const out = await registerFinancialSystem(TOKEN, 'org-1', 'idem-2', { baseUrl: BASE, fetchImpl })
    expect(out.registration_state).toBe('registered')
    expect(fetchImpl.mock.calls[0]![0]).toBe(`${BASE}/back-office/tpp-counterparties/org-1:register-financial-system`)
    expect((fetchImpl.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ 'idempotency-key': 'idem-2' })
  })

  it('POSTs /invoice-runs (four-eyes 202 + approval) with body + Idempotency-Key (BACKOFFICE-73)', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ data: { approval_request_id: 'ap-1', operation_type: 'billing.invoice_run', state: 'pending' } }, 202))
    const out = await createInvoiceRun(TOKEN, { billing_period: '2026-06', record_set_id: 'rec-1' }, 'idem-3', { baseUrl: BASE, fetchImpl })
    expect(out.approval_request_id).toBe('ap-1')
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(`${BASE}/back-office/invoice-runs`)
    expect(init!.method).toBe('POST')
    expect(init!.headers).toMatchObject({ 'idempotency-key': 'idem-3' })
    expect(JSON.parse(init!.body as string)).toEqual({ billing_period: '2026-06', record_set_id: 'rec-1' })
  })
})

describe('helpers', () => {
  it('formatMoney renders integer minor units; null → em dash', () => {
    expect(formatMoney({ amount: 145000, currency: 'AED' })).toBe('AED 1,450.00')
    expect(formatMoney(null)).toBe('—')
  })
  it('exposes the registerable registration states (subset of the contract enum)', () => {
    expect([...REGISTERABLE_STATES]).toEqual(['unregistered', 'onboarding'])
  })
})
