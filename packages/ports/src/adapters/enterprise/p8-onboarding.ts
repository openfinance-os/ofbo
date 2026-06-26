import type { OnboardingHandoverPort, OnboardingCase, OnboardingEntryPath } from '../../interfaces.js'

/**
 * P8 enterprise adapter — bank onboarding-handover system (the OPTIONAL funnel port, BACKOFFICE-34).
 * Follows the ADR 0023 pattern. Reads onboarding funnel events + per-case journeys from the bank's
 * onboarding/handover system over a window and normalizes them to the OFBO shapes — the entry-path
 * dimension (DIRECT_SIGNUP | ONBOARDING_HANDOVER) and the OnboardingCase journey.
 *
 * Like P2, the demo contract asserts seeded data (>0 events); enterprise binds the BEHAVIOURAL
 * contract (valid entry-path dimension + case shape) with whatever the real system returns in the
 * window — which may legitimately be empty. The HTTP transport is an injected seam (fetchOnboarding-
 * Http default; tests inject a fake — no network, no new dependency). No PSU PII: only funnel
 * stages, entry paths and timestamps cross the boundary.
 */

export interface OnboardingHttp {
  get(path: string): Promise<{ status: number; json: unknown }>
}

export interface OnboardingConfig {
  http: OnboardingHttp
}

function normalizeEntryPath(raw: unknown): OnboardingEntryPath {
  const s = String(raw ?? '').toUpperCase()
  return s === 'ONBOARDING_HANDOVER' || s.includes('HANDOVER') ? 'ONBOARDING_HANDOVER' : 'DIRECT_SIGNUP'
}

const qs = (w: { from: string; to: string }) => `?from=${encodeURIComponent(w.from)}&to=${encodeURIComponent(w.to)}`

async function getArray(http: OnboardingHttp, path: string): Promise<Record<string, unknown>[]> {
  const res = await http.get(path)
  if (res.status < 200 || res.status >= 300) throw new Error(`P8: onboarding system read failed (HTTP ${res.status})`)
  const json = res.json as { rows?: unknown[]; result?: unknown[] } | unknown[]
  const rows = Array.isArray(json) ? json : (json.rows ?? json.result ?? [])
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
}

export class OnboardingHandoverAdapter implements OnboardingHandoverPort {
  constructor(private readonly cfg: OnboardingConfig) {}

  async getFunnelEvents(window: { from: string; to: string }) {
    const rows = await getArray(this.cfg.http, `/onboarding/funnel/events${qs(window)}`)
    return rows.map((r) => ({
      entry_path: normalizeEntryPath(r.entry_path),
      stage: String(r.stage ?? ''),
      at: String(r.at ?? '')
    }))
  }

  async getOnboardingCases(window: { from: string; to: string }): Promise<OnboardingCase[]> {
    const rows = await getArray(this.cfg.http, `/onboarding/cases${qs(window)}`)
    return rows.map((r) => ({
      case_id: String(r.case_id ?? ''),
      entry_path: normalizeEntryPath(r.entry_path),
      reached_stages: Array.isArray(r.reached_stages) ? r.reached_stages.map(String) : [],
      abandoned_at_stage: r.abandoned_at_stage == null ? null : String(r.abandoned_at_stage),
      started_at: String(r.started_at ?? ''),
      activated_at: r.activated_at == null ? null : String(r.activated_at),
      cross_sell: Boolean(r.cross_sell)
    }))
  }
}

// ── fetch-backed transport (production default) ──────────────────────────────────────────────

export function fetchOnboardingHttp(baseUrl: string, authHeader: string): OnboardingHttp {
  const base = baseUrl.replace(/\/$/, '')
  return {
    async get(path) {
      const res = await fetch(`${base}${path}`, { method: 'GET', headers: { authorization: authHeader, accept: 'application/json' } })
      return { status: res.status, json: await res.json().catch(() => ({})) }
    }
  }
}

// ── Env factory ──────────────────────────────────────────────────────────────────────────────

export class OnboardingConfigError extends Error {
  constructor(message: string) {
    super(`P8 onboarding-handover adapter misconfigured: ${message}`)
    this.name = 'OnboardingConfigError'
  }
}

/** Construct from configuration. Required: P8_ONBOARDING_BASE_URL, P8_ONBOARDING_AUTH (full
 *  Authorization header). P8 is optional — a bank that declines it never sets these / uses the sim. */
export function onboardingHandoverFromEnv(env: Record<string, string | undefined>): OnboardingHandoverAdapter {
  const baseUrl = env.P8_ONBOARDING_BASE_URL
  if (!baseUrl) throw new OnboardingConfigError('P8_ONBOARDING_BASE_URL is required (the onboarding system API base URL)')
  const auth = env.P8_ONBOARDING_AUTH
  if (!auth) throw new OnboardingConfigError('P8_ONBOARDING_AUTH is required (a full Authorization header)')
  return new OnboardingHandoverAdapter({ http: fetchOnboardingHttp(baseUrl, auth) })
}
