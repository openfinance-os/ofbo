import { describe, expect, it, vi } from 'vitest'
import { getLiabilityMonitor, getRiskView, LIABILITY_MONITOR_PATH, RISK_VIEW_PATH } from '../src/lib/risk.js'
import { AnalyticsApiError } from '../src/lib/analytics.js'

/**
 * UI-07 — Risk client (BACKOFFICE-30/-36/-40). Reuses the shared analytics getter; asserts
 * the contract paths, Bearer + x-fapi-interaction-id propagation, and the {data,meta,freshness}
 * envelope (freshness is a top-level sibling, -40). fetch faked — no running BFF.
 */

const BASE = 'http://bff.test'
const TOKEN = 'demo-token:risk-analyst'

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('risk client — risk view (BACKOFFICE-30)', () => {
  it('GETs /risk-view and parses top-level data + freshness', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      okJson({ data: { open_signals: 2, anomalies: [] }, meta: {}, freshness: { view_refreshed_at: 'x', stale: false, stale_cause: null } })
    )
    const view = await getRiskView(TOKEN, { baseUrl: BASE, fetchImpl, traceId: 't1' })
    expect(view.data.open_signals).toBe(2)
    expect(view.freshness.stale).toBe(false)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(`${BASE}${RISK_VIEW_PATH}`)
    expect(init!.headers).toMatchObject({ authorization: `Bearer ${TOKEN}`, 'x-fapi-interaction-id': 't1' })
  })

  it('maps a non-2xx to a typed AnalyticsApiError', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ error: { code: 'BACKOFFICE.SCOPE_DENIED', message: 'no' } }, 403))
    await expect(getRiskView(TOKEN, { baseUrl: BASE, fetchImpl })).rejects.toBeInstanceOf(AnalyticsApiError)
    await expect(getRiskView(TOKEN, { baseUrl: BASE, fetchImpl })).rejects.toMatchObject({ code: 'BACKOFFICE.SCOPE_DENIED', status: 403 })
  })
})

describe('risk client — liability monitor (BACKOFFICE-36)', () => {
  it('GETs /nebras-liability-monitor and surfaces a stale freshness signal', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ data: { approaching: 1 }, freshness: { view_refreshed_at: 'x', stale: true, stale_cause: 'older_than_2x_source_cadence' } }))
    const view = await getLiabilityMonitor(TOKEN, { baseUrl: BASE, fetchImpl })
    expect(view.data.approaching).toBe(1)
    expect(view.freshness.stale_cause).toBe('older_than_2x_source_cadence')
    expect(fetchImpl.mock.calls[0]![0]).toBe(`${BASE}${LIABILITY_MONITOR_PATH}`)
  })
})
