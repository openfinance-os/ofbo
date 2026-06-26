import type { OnboardingCase, OnboardingHandoverPort } from '../../interfaces.js'

/**
 * P8 — Bank onboarding-handover enterprise adapter (pre-staged per ADR 0024, fidelity rung ③).
 *
 * Optional port (PRD §3 P8) — funnel events + per-case onboarding journeys for the analytics
 * funnel, with the DIRECT_SIGNUP vs ONBOARDING_HANDOVER entry-path dimension. The bank's
 * onboarding integration has no cross-vendor standard, so the adapter speaks a canonical REST
 * shape mapped in configuration (ADR 0024 guardrail 3).
 *
 * Implements EXACTLY the P8 port contract (`getFunnelEvents`, `getOnboardingCases`) — nothing
 * more. Transport injectable; fail-closed when unconfigured — tests inject a fake transport with
 * deterministic journeys, exercising the real call→parse path with no backend (guardrail 4 / rung ②).
 */

export interface OnboardingHandoverConfig {
  /** Bank Profile — onboarding REST base URL. Mandatory — fail-closed (tests inject a fake `fetchImpl`). */
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

export function createOnboardingHandoverAdapter(config: OnboardingHandoverConfig = {}): OnboardingHandoverPort {
  // FAIL-CLOSED: no silent fake under the enterprise profile — base URL + token are mandatory.
  if (!config.baseUrl) throw new OnboardingHandoverError(0, false, 'onboarding baseUrl is required (fail-closed)')
  if (!config.getToken) throw new OnboardingHandoverError(0, false, 'onboarding getToken is required')
  const getToken = config.getToken
  const base = config.baseUrl
  const doFetch = config.fetchImpl ?? globalThis.fetch

  async function call(path: string, window: { from: string; to: string }): Promise<Response> {
    const headers: Record<string, string> = { accept: 'application/json', authorization: `Bearer ${await getToken(window)}` }
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
  if (!env.ONBOARDING_URL || !token) {
    throw new OnboardingHandoverError(0, false, 'onboarding adapter misconfigured: set ONBOARDING_URL and ONBOARDING_TOKEN')
  }
  return createOnboardingHandoverAdapter({ baseUrl: env.ONBOARDING_URL, getToken: async () => token })
}
