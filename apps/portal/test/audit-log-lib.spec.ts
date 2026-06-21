import { describe, expect, it, vi } from 'vitest'
import { searchAuditEvents, AuditLogError } from '../src/lib/audit-log.js'

/**
 * DEMO-01 — global audit log data layer. Asserts the event-type filter + auth/trace headers
 * reach the BFF, the envelope is unwrapped, and a non-2xx surfaces a typed error.
 */

const ok = (data: unknown) => new Response(JSON.stringify({ data, meta: {} }), { status: 200, headers: { 'content-type': 'application/json' } })

describe('searchAuditEvents', () => {
  it('passes the event_type filter and Bearer/trace headers to GET /audit/events', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ok([{ id: 'e1', event_type: 'consent_revoked' }]))
    const rows = await searchAuditEvents('demo-token:compliance-officer', { eventType: 'consent_revoked' }, {
      baseUrl: 'http://bff.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      traceId: 'trace-1'
    })
    expect(rows).toHaveLength(1)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(String(url)).toContain('/audit/events?')
    expect(String(url)).toContain('event_type=consent_revoked')
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer demo-token:compliance-officer',
      'x-fapi-interaction-id': 'trace-1'
    })
  })

  it('throws a typed AuditLogError on a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'BACKOFFICE.SCOPE_DENIED', message: 'nope' } }), { status: 403 }))
    await expect(
      searchAuditEvents('demo-token:risk-analyst', {}, { baseUrl: 'http://bff.test', fetchImpl: fetchImpl as unknown as typeof fetch })
    ).rejects.toBeInstanceOf(AuditLogError)
  })
})
