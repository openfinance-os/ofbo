import { describe, expect, it, vi } from 'vitest'
import { getOperationsConsole, OPERATIONS_CONSOLE_PATH } from '../src/lib/operations.js'
import { AnalyticsApiError } from '../src/lib/analytics.js'

/**
 * UI-09 — Operations Console client (BACKOFFICE-28/-58/-40). Reuses the shared analytics
 * getter; asserts the contract path, Bearer + x-fapi-interaction-id propagation, and the
 * {data,meta,freshness} envelope (freshness is a top-level sibling, -40). fetch faked.
 */

const BASE = 'http://bff.test'
const TOKEN = 'demo-token:operations-analyst'

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('operations client (BACKOFFICE-28)', () => {
  it('GETs /operations-console and parses top-level data + freshness', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      okJson({ data: { slo: [{ name: 'recon', met: true }], active_outages: [] }, meta: {}, freshness: { view_refreshed_at: 'x', stale: false, stale_cause: null } })
    )
    const view = await getOperationsConsole(TOKEN, { baseUrl: BASE, fetchImpl, traceId: 't1' })
    expect(Array.isArray(view.data.slo)).toBe(true)
    expect(view.freshness.stale).toBe(false)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(`${BASE}${OPERATIONS_CONSOLE_PATH}`)
    expect(init!.headers).toMatchObject({ authorization: `Bearer ${TOKEN}`, 'x-fapi-interaction-id': 't1' })
  })

  it('surfaces a degraded-connectivity stale freshness', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ data: { connectivity: { status: 'degraded' } }, freshness: { view_refreshed_at: 'x', stale: true, stale_cause: 'older_than_2x_source_cadence' } }))
    const view = await getOperationsConsole(TOKEN, { baseUrl: BASE, fetchImpl })
    expect(view.freshness.stale_cause).toBe('older_than_2x_source_cadence')
  })

  it('maps a non-2xx to a typed AnalyticsApiError', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ error: { code: 'BACKOFFICE.SCOPE_DENIED', message: 'no' } }, 403))
    await expect(getOperationsConsole(TOKEN, { baseUrl: BASE, fetchImpl })).rejects.toBeInstanceOf(AnalyticsApiError)
    await expect(getOperationsConsole(TOKEN, { baseUrl: BASE, fetchImpl })).rejects.toMatchObject({ code: 'BACKOFFICE.SCOPE_DENIED', status: 403 })
  })
})
