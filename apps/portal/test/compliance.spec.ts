import { describe, expect, it, vi } from 'vitest'
import { getComplianceView, COMPLIANCE_VIEW_PATH } from '../src/lib/compliance.js'
import { AnalyticsApiError } from '../src/lib/analytics.js'

/** Compliance view client — reuses the shared analytics getter; asserts the contract path,
 *  Bearer + x-fapi-interaction-id propagation, and the {data,meta,freshness} envelope. */

const BASE = 'http://bff.test'
const TOKEN = 'demo-token:compliance-officer'

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('compliance client', () => {
  it('GETs /compliance-view and parses top-level data + freshness', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      okJson({ data: { open_inquiries: 1 }, meta: {}, freshness: { view_refreshed_at: 'x', stale: false, stale_cause: null } })
    )
    const view = await getComplianceView(TOKEN, { baseUrl: BASE, fetchImpl, traceId: 't1' })
    expect(view.data.open_inquiries).toBe(1)
    expect(view.freshness.stale).toBe(false)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(`${BASE}${COMPLIANCE_VIEW_PATH}`)
    expect(init!.headers).toMatchObject({ authorization: `Bearer ${TOKEN}`, 'x-fapi-interaction-id': 't1' })
  })

  it('maps a non-2xx to a typed AnalyticsApiError', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ error: { code: 'BACKOFFICE.SCOPE_DENIED', message: 'no' } }, 403))
    await expect(getComplianceView(TOKEN, { baseUrl: BASE, fetchImpl })).rejects.toBeInstanceOf(AnalyticsApiError)
  })
})
