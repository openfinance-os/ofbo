import { describe, expect, it, vi } from 'vitest'
import { createNebrasEgressAdapter, nebrasEgressFromEnv } from '../src/adapters/enterprise/nebras-egress.js'
import { NebrasEgressError } from '../src/adapters/sim.js'

const trace = { trace_id: '4d2c2e2a-0000-4000-8000-000000000000' }
const GW = 'https://egress.bank.example'

function fakeGateway(routes: Record<string, { status?: number; body?: unknown }> = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, init: init ?? {} })
    const key = Object.keys(routes).find((k) => u.includes(k))
    const r = key ? routes[key]! : { body: { ok: true } }
    return new Response(JSON.stringify(r.body ?? { ok: true }), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

describe('Nebras egress P6 adapter — routes through the egress gateway (no direct egress)', () => {
  it('targets the configured egress gateway, sends the bearer + x-fapi-interaction-id, never Nebras directly', async () => {
    const { calls, fetchImpl } = fakeGateway({ revoke: { body: { acknowledged_in_ms: 280 } } })
    const adapter = createNebrasEgressAdapter({ egressGatewayUrl: GW, getToken: async () => 'svc-tok', fetchImpl })

    const r = await adapter.revokeConsent('consent-001', 'CLIENT_INSTRUCTION', trace)

    expect(r.acknowledged_in_ms).toBe(280)
    expect(calls).toHaveLength(1)
    // HARD STOP: the request goes to the egress gateway host, not any nebras/scheme host.
    expect(calls[0]!.url.startsWith(GW)).toBe(true)
    expect(calls[0]!.url).toBe(`${GW}/consent-manager/consents/consent-001/revoke`)
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer svc-tok')
    expect(headers['x-fapi-interaction-id']).toBe(trace.trace_id)
  })

  it('maps every port method to its gateway route', async () => {
    const { calls, fetchImpl } = fakeGateway({
      '/tpp-reports/': { body: { published_at: '2026-06-28T00:00:00.000Z', rows: [{ a: 1 }] } },
      '/datasets/': { body: { published_at: '2026-06-28T00:00:00.000Z', rows: [] } },
      '/case-management/disputes': { body: { nebras_case_id: 'nc-1' } },
      '/directory': { body: { participants: [{ organisation_id: 'o1', legal_name: 'L1' }] } },
      '/refund': { body: { ipp_status: 'ACSP' } },
      '/consent-manager/consents/consent-001': { body: { consent_id: 'consent-001', status: 'Authorized' } }
    })
    const adapter = createNebrasEgressAdapter({ egressGatewayUrl: GW, getToken: async () => 't', fetchImpl })

    expect((await adapter.fetchTppReports('2026-06', trace)).rows).toHaveLength(1)
    expect((await adapter.fetchDataset('billing', '2026-06', trace)).published_at).toBeTruthy()
    expect((await adapter.createDisputeCase({ summary: 's' }, trace)).nebras_case_id).toBe('nc-1')
    expect((await adapter.syncDirectory(trace)).participants).toHaveLength(1)
    expect((await adapter.dispatchRefund('consent-001', { amount: 150000, currency: 'AED' }, trace)).ipp_status).toBe('ACSP')
    expect((await adapter.getConsentStatus('consent-001', trace)).status).toBe('Authorized')

    expect(calls.map((c) => c.url)).toEqual([
      `${GW}/tpp-reports/2026-06`,
      `${GW}/datasets/billing/2026-06`,
      `${GW}/case-management/disputes`,
      `${GW}/directory`,
      `${GW}/payment-consents/consent-001/refund`,
      `${GW}/consent-manager/consents/consent-001`
    ])
  })

  it('throws a retryable NebrasEgressError on 429/5xx, non-retryable on 4xx', async () => {
    const a429 = createNebrasEgressAdapter({ egressGatewayUrl: GW, getToken: async () => 't', fetchImpl: fakeGateway({ '/tpp-reports/': { status: 429 } }).fetchImpl })
    await expect(a429.fetchTppReports('2026-06', trace)).rejects.toMatchObject({ name: 'NebrasEgressError', retryable: true, status: 429 })

    const a400 = createNebrasEgressAdapter({ egressGatewayUrl: GW, getToken: async () => 't', fetchImpl: fakeGateway({ '/directory': { status: 400 } }).fetchImpl })
    await expect(a400.syncDirectory(trace)).rejects.toMatchObject({ retryable: false, status: 400 })
  })

  it('requires a gateway token provider once the gateway URL is set (no anonymous egress)', async () => {
    const adapter = createNebrasEgressAdapter({ egressGatewayUrl: GW })
    await expect(adapter.getConsentStatus('c1', trace)).rejects.toBeInstanceOf(NebrasEgressError)
  })
})

describe('Nebras egress P6 adapter — fake gateway (no backend / contract context)', () => {
  it('runs the full P6 contract against the in-memory fake gateway deterministically', async () => {
    const adapter = createNebrasEgressAdapter() // no gateway URL → fake
    expect((await adapter.revokeConsent('c1', 'CLIENT_INSTRUCTION', trace)).acknowledged_in_ms).toBeLessThan(5000)
    expect((await adapter.dispatchRefund('c1', { amount: 1, currency: 'AED' }, trace)).ipp_status).toBe('ACSP')
    const dir1 = await adapter.syncDirectory(trace)
    const dir2 = await adapter.syncDirectory(trace)
    expect(dir1).toEqual(dir2)
    expect((await adapter.getConsentStatus('c9', trace)).consent_id).toBe('c9')
  })

  it('nebrasEgressFromEnv binds the fake path when EGRESS_GATEWAY_URL is unset', async () => {
    const adapter = nebrasEgressFromEnv({})
    expect((await adapter.createDisputeCase({ summary: 's' }, trace)).nebras_case_id).toBeTruthy()
  })
})
