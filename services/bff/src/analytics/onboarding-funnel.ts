import type { Context } from 'hono'
import type { OnboardingCase, OnboardingEntryPath } from '@ofbo/ports'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import { scopeDenied } from '../errors.js'
import { dataEnvelope } from '../envelope.js'
import { liveFreshness, type FreshnessEnvelope } from './freshness.js'

/**
 * BACKOFFICE-34 — onboarding funnel metric surfacing. A read-only analytics view
 * (pipeline:read, enforced at the BFF middleware AND re-checked here) over the P8
 * onboarding-case journeys. The five canonical metrics — cycle time, handover count,
 * stage abandonment, cross-sell conversion, entry-path mix — each with drill-down by
 * entry path (DIRECT_SIGNUP vs ONBOARDING_HANDOVER). Aggregate figures only, no PSU PII.
 * With the freshness envelope (BACKOFFICE-40).
 */

export const ONBOARDING_FUNNEL_SCOPE = 'pipeline:read'
const STAGES = ['initiated', 'kyc', 'consent_grant', 'activated'] as const
const ENTRY_PATHS: OnboardingEntryPath[] = ['DIRECT_SIGNUP', 'ONBOARDING_HANDOVER']

export interface OnboardingCaseReader {
  getOnboardingCases(window: { from: string; to: string }): Promise<OnboardingCase[]>
}

export interface OnboardingFunnelDeps {
  cases: OnboardingCaseReader
  now?: () => Date
}

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp

/** Nearest-rank percentile over an ascending-sorted numeric array. */
function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null
  const rank = Math.ceil((p / 100) * sortedAsc.length)
  return sortedAsc[Math.min(rank, sortedAsc.length) - 1]!
}

function cycleTime(cases: OnboardingCase[]) {
  const hours = cases
    .filter((c) => c.activated_at !== null)
    .map((c) => (new Date(c.activated_at!).getTime() - new Date(c.started_at).getTime()) / 3_600_000)
    .sort((a, b) => a - b)
  return {
    activated_count: hours.length,
    avg_hours: hours.length ? round(hours.reduce((a, b) => a + b, 0) / hours.length) : null,
    p50_hours: percentile(hours, 50),
    p90_hours: percentile(hours, 90)
  }
}

function stageAbandonment(cases: OnboardingCase[]) {
  const byStage: Record<string, number> = {}
  let total = 0
  for (const c of cases) {
    if (c.abandoned_at_stage) {
      byStage[c.abandoned_at_stage] = (byStage[c.abandoned_at_stage] ?? 0) + 1
      total += 1
    }
  }
  return { by_stage: byStage, total }
}

function crossSell(cases: OnboardingCase[]) {
  const activated = cases.filter((c) => c.activated_at !== null)
  const crossSold = activated.filter((c) => c.cross_sell).length
  return { activated: activated.length, cross_sold: crossSold, rate: activated.length ? round(crossSold / activated.length, 4) : null }
}

function metricsFor(cases: OnboardingCase[]) {
  return { case_count: cases.length, cycle_time: cycleTime(cases), stage_abandonment: stageAbandonment(cases), cross_sell_conversion: crossSell(cases) }
}

export class OnboardingFunnelService {
  constructor(private readonly deps: OnboardingFunnelDeps) {}

  async view(principal: Principal): Promise<{ data: Record<string, unknown>; freshness: FreshnessEnvelope }> {
    assertScope(principal, ONBOARDING_FUNNEL_SCOPE)
    const now = (this.deps.now ?? (() => new Date()))()
    const windowEnd = now.toISOString()
    const windowStart = new Date(now.getTime() - 90 * 24 * 3600 * 1000).toISOString()
    const cases = await this.deps.cases.getOnboardingCases({ from: windowStart, to: windowEnd })

    const entryPathMix: Record<string, number> = {}
    for (const p of ENTRY_PATHS) entryPathMix[p] = cases.filter((c) => c.entry_path === p).length
    const byEntryPath: Record<string, ReturnType<typeof metricsFor>> = {}
    for (const p of ENTRY_PATHS) byEntryPath[p] = metricsFor(cases.filter((c) => c.entry_path === p))

    const data = {
      funnel_stages: STAGES,
      total_cases: cases.length,
      // metric 5 — entry-path mix; metric 2 — handover count
      entry_path_mix: entryPathMix,
      handover_count: entryPathMix.ONBOARDING_HANDOVER ?? 0,
      // metrics 1/3/4 with drill-down by entry path
      overall: metricsFor(cases),
      by_entry_path: byEntryPath
    }
    // BACKOFFICE-40 — live-computed view (no external source) → always fresh.
    return { data, freshness: liveFreshness(now) }
  }
}

type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

export function onboardingFunnelRoutes(service: OnboardingFunnelService): Record<string, Handler> {
  return {
    'get /back-office/analytics/onboarding-funnel': async (c) => {
      try {
        const { data, freshness } = await service.view(c.get('principal'))
        return c.json({ ...dataEnvelope(data), freshness }, 200)
      } catch (e) {
        const denied = scopeDenied(c, e)
        if (denied) return denied
        throw e
      }
    }
  }
}
