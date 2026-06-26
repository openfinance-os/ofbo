import { describe, expect, it, vi } from 'vitest'
import { createOnboardingHandoverAdapter, onboardingHandoverFromEnv, OnboardingHandoverError } from '../src/adapters/enterprise/onboarding-handover.js'

const BASE = 'https://onboarding.bank.example'
const window = { from: '2026-01-01', to: '2026-12-31' }

function fakeTransport(body: unknown, status = 200) {
  const calls: { url: string }[] = []
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    calls.push({ url: String(url) })
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

describe('P8 onboarding-handover adapter', () => {
  it('GETs funnel events with the window and surfaces the entry-path dimension', async () => {
    const { calls, fetchImpl } = fakeTransport([{ entry_path: 'ONBOARDING_HANDOVER', stage: 'activated', at: '2026-06-03T12:00:00Z' }])
    const adapter = createOnboardingHandoverAdapter({ baseUrl: BASE, getToken: async () => 't', fetchImpl })
    const events = await adapter.getFunnelEvents(window)
    expect(events[0]!.entry_path).toBe('ONBOARDING_HANDOVER')
    expect(calls[0]!.url).toBe(`${BASE}/funnel-events?from=2026-01-01&to=2026-12-31`)
  })

  it('GETs onboarding cases', async () => {
    const { calls, fetchImpl } = fakeTransport([{ case_id: 'ob-1', entry_path: 'DIRECT_SIGNUP', reached_stages: ['initiated'], abandoned_at_stage: 'initiated', started_at: 'x', activated_at: null, cross_sell: false }])
    const adapter = createOnboardingHandoverAdapter({ baseUrl: BASE, getToken: async () => 't', fetchImpl })
    const cases = await adapter.getOnboardingCases(window)
    expect(cases[0]!.case_id).toBe('ob-1')
    expect(calls[0]!.url).toBe(`${BASE}/onboarding-cases?from=2026-01-01&to=2026-12-31`)
  })

  it('throws retryable on 5xx and requires a token when baseUrl is set', async () => {
    await expect(createOnboardingHandoverAdapter({ baseUrl: BASE, getToken: async () => 't', fetchImpl: fakeTransport([], 500).fetchImpl }).getFunnelEvents(window)).rejects.toMatchObject({ retryable: true, status: 500 })
    await expect(createOnboardingHandoverAdapter({ baseUrl: BASE }).getFunnelEvents(window)).rejects.toBeInstanceOf(OnboardingHandoverError)
  })

  it('fake path / fromEnv: deterministic funnel events with both entry paths', async () => {
    const events = await onboardingHandoverFromEnv({}).getFunnelEvents(window)
    expect(events.length).toBeGreaterThan(0)
    for (const e of events) expect(['DIRECT_SIGNUP', 'ONBOARDING_HANDOVER']).toContain(e.entry_path)
  })
})
