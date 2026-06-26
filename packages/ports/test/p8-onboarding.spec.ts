import { describe, expect, it } from 'vitest'
import {
  OnboardingHandoverAdapter,
  onboardingHandoverFromEnv,
  OnboardingConfigError,
  type OnboardingHttp
} from '../src/adapters/enterprise/p8-onboarding.js'

const WINDOW = { from: '2026-01-01', to: '2026-12-31' }

function fakeHttp(byPath: Record<string, { status?: number; json: unknown }>) {
  const calls: string[] = []
  const http: OnboardingHttp = {
    async get(path) {
      calls.push(path)
      const key = Object.keys(byPath).find((k) => path.startsWith(k))
      const hit = key ? byPath[key]! : { status: 200, json: [] }
      return { status: hit.status ?? 200, json: hit.json }
    }
  }
  return { http, calls }
}

const adapter = (http: OnboardingHttp) => new OnboardingHandoverAdapter({ http })

describe('P8 onboarding-handover adapter — getFunnelEvents (behavioural contract)', () => {
  it('returns events with the entry-path dimension, normalized to the canonical enum', async () => {
    const { http, calls } = fakeHttp({
      '/onboarding/funnel/events': {
        json: [
          { entry_path: 'DIRECT_SIGNUP', stage: 'started', at: '2026-03-01' },
          { entry_path: 'partner-handover', stage: 'kyc', at: '2026-03-02' }, // vendor synonym → ONBOARDING_HANDOVER
          { entry_path: 'whatever', stage: 'activated', at: '2026-03-03' } // unknown → DIRECT_SIGNUP default
        ]
      }
    })
    const events = await adapter(http).getFunnelEvents(WINDOW)
    expect(calls[0]).toContain('/onboarding/funnel/events?from=2026-01-01&to=2026-12-31')
    expect(events).toHaveLength(3)
    for (const e of events) expect(['DIRECT_SIGNUP', 'ONBOARDING_HANDOVER']).toContain(e.entry_path)
    expect(events[1]!.entry_path).toBe('ONBOARDING_HANDOVER')
    expect(events[2]!.entry_path).toBe('DIRECT_SIGNUP')
  })

  it('accepts a {rows:[...]} envelope and an empty window (enterprise may legitimately be empty)', async () => {
    const wrapped = fakeHttp({ '/onboarding/funnel/events': { json: { rows: [{ entry_path: 'DIRECT_SIGNUP', stage: 's', at: 't' }] } } })
    expect(await adapter(wrapped.http).getFunnelEvents(WINDOW)).toHaveLength(1)
    const empty = fakeHttp({ '/onboarding/funnel/events': { json: [] } })
    expect(await adapter(empty.http).getFunnelEvents(WINDOW)).toEqual([])
  })

  it('throws on a non-2xx onboarding-system read', async () => {
    const { http } = fakeHttp({ '/onboarding/funnel/events': { status: 502, json: {} } })
    await expect(adapter(http).getFunnelEvents(WINDOW)).rejects.toThrow(/HTTP 502/)
  })
})

describe('P8 onboarding-handover adapter — getOnboardingCases', () => {
  it('maps per-case journeys to the OnboardingCase shape', async () => {
    const { http } = fakeHttp({
      '/onboarding/cases': {
        json: [
          { case_id: 'c-1', entry_path: 'ONBOARDING_HANDOVER', reached_stages: ['started', 'kyc'], abandoned_at_stage: 'kyc', started_at: '2026-03-01', activated_at: null, cross_sell: false },
          { case_id: 'c-2', entry_path: 'direct', reached_stages: ['started', 'kyc', 'activated'], abandoned_at_stage: null, started_at: '2026-03-02', activated_at: '2026-03-05', cross_sell: true }
        ]
      }
    })
    const cases = await adapter(http).getOnboardingCases(WINDOW)
    expect(cases).toHaveLength(2)
    expect(cases[0]).toMatchObject({ case_id: 'c-1', entry_path: 'ONBOARDING_HANDOVER', abandoned_at_stage: 'kyc', activated_at: null, cross_sell: false })
    expect(cases[1]).toMatchObject({ case_id: 'c-2', entry_path: 'DIRECT_SIGNUP', abandoned_at_stage: null, activated_at: '2026-03-05', cross_sell: true })
    expect(cases[1]!.reached_stages).toEqual(['started', 'kyc', 'activated'])
  })
})

describe('P8 onboarding-handover adapter — config', () => {
  it('throws a clear config error on missing url/auth', () => {
    expect(() => onboardingHandoverFromEnv({})).toThrow(OnboardingConfigError)
    expect(() => onboardingHandoverFromEnv({ P8_ONBOARDING_BASE_URL: 'https://x' })).toThrow(/AUTH/)
  })
  it('constructs from a complete config', () => {
    expect(onboardingHandoverFromEnv({ P8_ONBOARDING_BASE_URL: 'https://x', P8_ONBOARDING_AUTH: 'Bearer t' })).toBeInstanceOf(OnboardingHandoverAdapter)
  })
})
