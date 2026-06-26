import type { OnboardingCase, OnboardingHandoverPort } from '../../interfaces.js'

/**
 * P8 — Bank onboarding-handover enterprise adapter (pre-staged per ADR 0023, fidelity rung ③).
 *
 * Optional port (PRD §3 P8) — funnel events + per-case onboarding journeys for the analytics
 * funnel, with the DIRECT_SIGNUP vs ONBOARDING_HANDOVER entry-path dimension. The bank's
 * onboarding integration has no cross-vendor standard, so the adapter speaks a canonical REST
 * shape mapped in configuration (ADR 0023 guardrail 3).
 *
 * Implements EXACTLY the P8 port contract (`getFunnelEvents`, `getOnboardingCases`) — nothing
 * more. Transport injectable; with no base URL it binds an in-memory fake with deterministic
 * journeys, so the contract runs the real call→parse path with no backend (guardrail 4 / rung ②).
 */

export interface OnboardingHandoverConfig {
  /** Bank Profile — onboarding REST base URL. When unset, the in-memory fake is used. */
  baseUrl?: string
  /** Bank Profile — bearer provider. Required once baseUrl is set. */
  getToken?: (window: { from: string; to: string }) => Promise<string>
  /** Injectable transport (defaults to global fetch on the real path). */
  fetchImpl?: typeof fetch
}

export class OnboardingHandoverError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
    message: string
  ) {
    super(message)
    this.name = 'OnboardingHandoverError'
  }
}

const FAKE_BASE = 'https://fake.onboarding.invalid'

const FAKE_CASES: OnboardingCase[] = [
  { case_id: 'ob-ds-01', entry_path: 'DIRECT_SIGNUP', reached_stages: ['initiated', 'kyc', 'consent_grant', 'activated'], abandoned_at_stage: null, started_at: '2026-06-01T09:00:00.000Z', activated_at: '2026-06-01T21:00:00.000Z', cross_sell: true },
  { case_id: 'ob-ho-01', entry_path: 'ONBOARDING_HANDOVER', reached_stages: ['initiated', 'kyc', 'consent_grant', 'activated'], abandoned_at_stage: null, started_at: '2026-06-02T08:00:00.000Z', activated_at: '2026-06-02T12:00:00.000Z', cross_sell: true }
]

const fakeOnboardingFetch: typeof fetch = async (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  if (/\/funnel-events/.test(url)) {
    return json([
      { entry_path: 'DIRECT_SIGNUP', stage: 'kyc_complete', at: '2026-06-01T10:00:00.000Z' },
      { entry_path: 'ONBOARDING_HANDOVER', stage: 'activated', at: '2026-06-03T12:00:00.000Z' }
    ])
  }
  if (/\/onboarding-cases/.test(url)) return json(FAKE_CASES)
  return new Response(JSON.stringify({ error: 'unhandled' }), { status: 404 })
}

export function createOnboardingHandoverAdapter(config: OnboardingHandoverConfig = {}): OnboardingHandoverPort {
  const real = Boolean(config.baseUrl)
  const base = config.baseUrl ?? FAKE_BASE
  const doFetch = config.fetchImpl ?? (real ? globalThis.fetch : fakeOnboardingFetch)

  async function call(path: string, window: { from: string; to: string }): Promise<Response> {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (real) {
      if (!config.getToken) throw new OnboardingHandoverError(0, false, 'onboarding getToken is required when baseUrl is set')
      headers.authorization = `Bearer ${await config.getToken(window)}`
    }
    const qs = `?from=${encodeURIComponent(window.from)}&to=${encodeURIComponent(window.to)}`
    const res = await doFetch(`${base}${path}${qs}`, { headers })
    if (!res.ok) throw new OnboardingHandoverError(res.status, res.status === 429 || res.status >= 500, `onboarding ${path} → ${res.status}`)
    return res
  }

  return {
    async getFunnelEvents(window) {
      const res = await call('/funnel-events', window)
      return (await res.json()) as { entry_path: 'DIRECT_SIGNUP' | 'ONBOARDING_HANDOVER'; stage: string; at: string }[]
    },
    async getOnboardingCases(window) {
      const res = await call('/onboarding-cases', window)
      return (await res.json()) as OnboardingCase[]
    }
  }
}

export function onboardingHandoverFromEnv(env: NodeJS.ProcessEnv = process.env): OnboardingHandoverPort {
  const token = env.ONBOARDING_TOKEN
  return createOnboardingHandoverAdapter({ baseUrl: env.ONBOARDING_URL, getToken: token ? async () => token : undefined })
}
