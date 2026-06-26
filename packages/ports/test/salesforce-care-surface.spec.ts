import { describe, expect, it, vi } from 'vitest'
import {
  createSalesforceCareSurfaceAdapter,
  salesforceCareSurfaceFromEnv,
  SalesforceCareError
} from '../src/adapters/enterprise/salesforce-care-surface.js'

const trace = { trace_id: '4d2c2e2a-0000-4000-8000-000000000000' }

/** Captures requests and returns canned token-exchange / Service Cloud Voice responses —
 *  the rung-② sandbox harness (no tenant). `route` picks the body by URL. */
function fakeTransport(routes: { token?: { status?: number; body?: unknown }; record?: { status?: number; body?: unknown } } = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, init: init ?? {} })
    if (u.includes('/oauth2/token')) {
      return new Response(JSON.stringify(routes.token?.body ?? { access_token: 'care-tok', expires_in: 900 }), { status: routes.token?.status ?? 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify(routes.record?.body ?? { Id: '0LQabc', RecordingUrl: 'https://acme.my.salesforce.com/lightning/r/VoiceCall/0LQabc/view' }), { status: routes.record?.status ?? 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

describe('Salesforce P1 adapter — mintCareToken (RFC 8693 token exchange)', () => {
  it('exchanges actor=agent / subject=PSU and returns a token with act+sub and ≤15-min expiry', async () => {
    const { calls, fetchImpl } = fakeTransport()
    const adapter = createSalesforceCareSurfaceAdapter({ tokenExchangeUrl: 'https://auth.bank.example/oauth2/token', fetchImpl })

    const t = await adapter.mintCareToken({ agent_id: 'agent-001', psu_id: 'psu-001' }, trace)

    expect(t).toMatchObject({ token: 'care-tok', act: 'agent-001', sub: 'psu-001' })
    expect(new Date(t.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000)
    const params = new URLSearchParams(String(calls[0]!.init.body))
    expect(params.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:token-exchange')
    expect(params.get('actor_token')).toBe('agent-001')
    expect(params.get('subject_token')).toBe('psu-001')
    expect((calls[0]!.init.headers as Record<string, string>)['x-fapi-interaction-id']).toBe(trace.trace_id)
  })

  it('rejects a care token whose TTL exceeds the 15-min regulatory ceiling (ADR 0001)', async () => {
    const { fetchImpl } = fakeTransport({ token: { body: { access_token: 'x', expires_in: 3600 } } })
    const adapter = createSalesforceCareSurfaceAdapter({ tokenExchangeUrl: 'https://auth.bank.example/oauth2/token', fetchImpl })
    await expect(adapter.mintCareToken({ agent_id: 'a', psu_id: 'p' }, trace)).rejects.toMatchObject({ name: 'SalesforceCareError' })
  })

  it('throws a retryable error on a 5xx from the token endpoint', async () => {
    const { fetchImpl } = fakeTransport({ token: { status: 503 } })
    const adapter = createSalesforceCareSurfaceAdapter({ tokenExchangeUrl: 'https://auth.bank.example/oauth2/token', fetchImpl })
    await expect(adapter.mintCareToken({ agent_id: 'a', psu_id: 'p' }, trace)).rejects.toMatchObject({ retryable: true, status: 503 })
  })
})

describe('Salesforce P1 adapter — resolveCallRecording (link, never copy — ADR 0003)', () => {
  it('resolves a call id to a short-lived Service Cloud Voice locator', async () => {
    const { calls, fetchImpl } = fakeTransport()
    const adapter = createSalesforceCareSurfaceAdapter({ instanceUrl: 'https://acme.my.salesforce.com', getToken: async () => 'tok', fetchImpl })

    const r = await adapter.resolveCallRecording({ call_id: 'CA123' }, trace)

    expect(r).not.toBeNull()
    expect(r!.recording_ref).toBe('0LQabc')
    expect(r!.recording_url).toContain('/VoiceCall/')
    expect(new Date(r!.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000)
    expect(calls[0]!.url).toBe('https://acme.my.salesforce.com/services/data/v60.0/sobjects/VoiceCall/CallSid/CA123')
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok')
  })

  it('returns null for an empty call id without calling Salesforce (non-voice channel)', async () => {
    const { calls, fetchImpl } = fakeTransport()
    const adapter = createSalesforceCareSurfaceAdapter({ instanceUrl: 'https://acme.my.salesforce.com', getToken: async () => 'tok', fetchImpl })
    expect(await adapter.resolveCallRecording({ call_id: '' }, trace)).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('returns null (not an error) when Salesforce has no recording on file (404)', async () => {
    const { fetchImpl } = fakeTransport({ record: { status: 404, body: { error: 'not found' } } })
    const adapter = createSalesforceCareSurfaceAdapter({ instanceUrl: 'https://acme.my.salesforce.com', getToken: async () => 'tok', fetchImpl })
    expect(await adapter.resolveCallRecording({ call_id: 'CA404' }, trace)).toBeNull()
  })

  it('throws when the instance is configured but no connected-app token provider is wired', async () => {
    const adapter = createSalesforceCareSurfaceAdapter({ instanceUrl: 'https://acme.my.salesforce.com' })
    await expect(adapter.resolveCallRecording({ call_id: 'CA1' }, trace)).rejects.toBeInstanceOf(SalesforceCareError)
  })

  it('throws a retryable error on a 5xx recording lookup', async () => {
    const { fetchImpl } = fakeTransport({ record: { status: 502 } })
    const adapter = createSalesforceCareSurfaceAdapter({ instanceUrl: 'https://acme.my.salesforce.com', getToken: async () => 'tok', fetchImpl })
    await expect(adapter.resolveCallRecording({ call_id: 'CA1' }, trace)).rejects.toMatchObject({ retryable: true, status: 502 })
  })
})

describe('Salesforce P1 adapter — fake path (no tenant / contract context)', () => {
  it('mints a care token end-to-end against the in-memory fake token endpoint', async () => {
    const adapter = createSalesforceCareSurfaceAdapter() // no token/instance URL → fake path
    const t = await adapter.mintCareToken({ agent_id: 'agent-x', psu_id: 'psu-y' }, trace)
    expect(t).toMatchObject({ act: 'agent-x', sub: 'psu-y' })
    expect(t.token).toContain('agent-x')
  })

  it('resolves / yields null against the in-memory fake Voice lookup', async () => {
    const adapter = createSalesforceCareSurfaceAdapter()
    expect(await adapter.resolveCallRecording({ call_id: 'missing' }, trace)).toBeNull()
    const r = await adapter.resolveCallRecording({ call_id: 'CA9' }, trace)
    expect(r!.recording_ref).toBe('0LQCA9')
  })

  it('salesforceCareSurfaceFromEnv binds the fake path when no Salesforce env is set', async () => {
    const adapter = salesforceCareSurfaceFromEnv({})
    const t = await adapter.mintCareToken({ agent_id: 'a', psu_id: 'p' }, trace)
    expect(t.act).toBe('a')
  })
})
