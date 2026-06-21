import { describe, expect, it, vi } from 'vitest'
import { formatMoney, getExecutiveDashboard, getFinanceView, isMoney, AnalyticsApiError } from '../src/lib/analytics.js'

/**
 * UI-06 — Analytics client (BACKOFFICE-27/-31/-40). Asserts the contract paths, Bearer +
 * x-fapi-interaction-id propagation, and the NON-STANDARD { data, meta, freshness } envelope
 * where freshness is a top-level sibling of data (-40), plus the Money guard for the renderer.
 */

const BASE = 'http://bff.test'
const TOKEN = 'demo-token:commercial-desk-head'
const A = '/back-office/analytics'

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('analytics client — executive dashboard (BACKOFFICE-27)', () => {
  it('GETs /executive-dashboard and parses top-level data + freshness', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      okJson({ data: { period: '2026-06', headline: { x: 1 } }, meta: {}, freshness: { view_refreshed_at: '2026-06-17T00:00:00Z', stale: false, stale_cause: null } })
    )
    const view = await getExecutiveDashboard(TOKEN, { baseUrl: BASE, fetchImpl, traceId: 't1' })
    expect(view.data.period).toBe('2026-06')
    expect(view.freshness.stale).toBe(false)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(`${BASE}${A}/executive-dashboard`)
    expect(init!.headers).toMatchObject({ authorization: `Bearer ${TOKEN}`, 'x-fapi-interaction-id': 't1' })
  })

  it('maps a non-2xx to a typed AnalyticsApiError', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ error: { code: 'BACKOFFICE.SCOPE_DENIED', message: 'no' } }, 403))
    await expect(getExecutiveDashboard(TOKEN, { baseUrl: BASE, fetchImpl })).rejects.toBeInstanceOf(AnalyticsApiError)
    await expect(getExecutiveDashboard(TOKEN, { baseUrl: BASE, fetchImpl })).rejects.toMatchObject({ code: 'BACKOFFICE.SCOPE_DENIED', status: 403 })
  })

  it('UX-06: parses remediation + docs_url from the error envelope into the typed error', async () => {
    const fetchImpl = vi.fn(async () =>
      okJson({ error: { code: 'BACKOFFICE.ANALYTICS_UNAVAILABLE', message: 'Temporarily unavailable.', remediation: 'Retry shortly.', docs_url: 'https://docs.ofbo/analytics' } }, 503)
    )
    await expect(getExecutiveDashboard(TOKEN, { baseUrl: BASE, fetchImpl })).rejects.toMatchObject({
      remediation: 'Retry shortly.',
      docsUrl: 'https://docs.ofbo/analytics'
    })
  })

  it('falls back to a stale freshness when the response omits it', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ data: {} }))
    const view = await getExecutiveDashboard(TOKEN, { baseUrl: BASE, fetchImpl })
    expect(view.freshness.stale).toBe(true)
  })
})

describe('analytics client — finance view (BACKOFFICE-31)', () => {
  it('GETs /finance-view with NO query params (the contract declares none) and parses freshness', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ data: { period: '2026-05' }, freshness: { view_refreshed_at: 'x', stale: true, stale_cause: 'last_ingestion_failed' } }))
    const view = await getFinanceView(TOKEN, { baseUrl: BASE, fetchImpl })
    expect(view.freshness.stale_cause).toBe('last_ingestion_failed')
    expect(view.data.period).toBe('2026-05')
    expect(fetchImpl.mock.calls[0]![0]).toBe(`${BASE}${A}/finance-view`)
  })
})

describe('money helpers', () => {
  it('isMoney recognises {amount,currency} and rejects other shapes', () => {
    expect(isMoney({ amount: 100, currency: 'AED' })).toBe(true)
    expect(isMoney({ amount: 100 })).toBe(false)
    expect(isMoney(5)).toBe(false)
  })
  it('formatMoney renders integer minor units as major units', () => {
    expect(formatMoney({ amount: 145000, currency: 'AED' })).toBe('AED 1,450.00')
  })
})
