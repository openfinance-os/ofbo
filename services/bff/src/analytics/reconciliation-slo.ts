import type { Context } from 'hono'
import type { StoredReconciliationBreak, StoredReconciliationRun } from '@ofbo/db'
import type { Principal } from '../auth.js'
import { assertScope, ScopeDeniedError, scopeDenialEnvelope } from '../rbac.js'
import { dataEnvelope } from '../envelope.js'
import { liveFreshness, type FreshnessEnvelope } from './freshness.js'
import type { ReconciliationBreakStore, ReconciliationLogStore } from '../reconciliation/service.js'

/**
 * BACKOFFICE-09 — Reconciliation Console SLO dashboard. A read-only analytics view
 * (reconciliation:read, enforced at the BFF middleware AND re-checked here) that
 * aggregates reconciliation health for the console: open breaks by age bucket,
 * p50/p90 break-resolution time (30-day rolling), the Nebras/fintech dispute pipeline,
 * last/next run, and pass rate. Server-side aggregation over reconciliation_log +
 * reconciliation_break; returns the standard AnalyticsView envelope (free-form data +
 * BACKOFFICE-40 freshness). No PSU PII (counts + durations only).
 */

export const RECON_SLO_SCOPE = 'reconciliation:read'

const EPOCH = '1970-01-01T00:00:00.000Z'
const DAY_MS = 24 * 60 * 60 * 1000
const THIRTY_DAYS_MS = 30 * DAY_MS
const OPEN_STATUSES = new Set(['flagged', 'assigned'])
const RESOLVED_STATUSES = new Set(['resolved_matched', 'resolved_internal_correction'])

/** Linear-interpolation percentile over an unsorted numeric sample; null when empty. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]!
  const rank = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return sorted[lo]!
  return sorted[lo]! + (rank - lo) * (sorted[hi]! - sorted[lo]!)
}

/** Age bucket key for an open break, given its age in ms. */
export function ageBucket(ageMs: number): 'under_1d' | '1_to_3d' | '3_to_7d' | 'over_7d' {
  if (ageMs < DAY_MS) return 'under_1d'
  if (ageMs < 3 * DAY_MS) return '1_to_3d'
  if (ageMs < 7 * DAY_MS) return '3_to_7d'
  return 'over_7d'
}

const passRate = (run: StoredReconciliationRun): number | null => {
  const total = run.line_count_total ?? 0
  if (total <= 0) return null
  return ((run.line_count_matched ?? 0) / total) * 100
}

export interface ReconciliationSloDeps {
  breaks: Pick<ReconciliationBreakStore, 'listForRange'>
  runs: Pick<ReconciliationLogStore, 'list'>
  now?: () => Date
}

export class ReconciliationSloService {
  constructor(private readonly deps: ReconciliationSloDeps) {}

  async view(principal: Principal): Promise<{ data: Record<string, unknown>; freshness: FreshnessEnvelope }> {
    assertScope(principal, RECON_SLO_SCOPE)
    const now = (this.deps.now ?? (() => new Date()))()
    const nowMs = now.getTime()

    const breaks: StoredReconciliationBreak[] = await this.deps.breaks.listForRange(EPOCH, now.toISOString())

    // Open breaks by age bucket.
    const byAge: Record<string, number> = { under_1d: 0, '1_to_3d': 0, '3_to_7d': 0, over_7d: 0 }
    let openTotal = 0
    for (const b of breaks) {
      if (!OPEN_STATUSES.has(b.status)) continue
      openTotal++
      const bucket = ageBucket(nowMs - new Date(b.created_at).getTime())
      byAge[bucket] = (byAge[bucket] ?? 0) + 1
    }

    // Break-resolution durations (hours), 30-day rolling on resolved_at.
    const durationsHours: number[] = []
    for (const b of breaks) {
      if (!RESOLVED_STATUSES.has(b.status) || !b.resolved_at) continue
      const resolvedMs = new Date(b.resolved_at).getTime()
      if (nowMs - resolvedMs > THIRTY_DAYS_MS) continue
      durationsHours.push((resolvedMs - new Date(b.created_at).getTime()) / (60 * 60 * 1000))
    }
    const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10)

    // Dispute pipeline (open escalations).
    const openNebrasDisputes = breaks.filter((b) => b.status === 'escalated_nebras_dispute').length
    const openFintechEscalations = breaks.filter((b) => b.status === 'escalated_fintech_billing').length

    // Last/next run + pass rate (30-day rolling over completed runs).
    const { rows: runs } = await this.deps.runs.list({ limit: 30 })
    const last = runs[0] ?? null
    const recentRates = runs
      .filter((r) => nowMs - new Date(r.created_at).getTime() <= THIRTY_DAYS_MS)
      .map(passRate)
      .filter((r): r is number => r !== null)
    const passRate30d = recentRates.length ? recentRates.reduce((a, b) => a + b, 0) / recentRates.length : null

    const data = {
      open_breaks: { total: openTotal, by_age_bucket: byAge },
      resolution_time_30d: {
        sample_size: durationsHours.length,
        p50_hours: round1(percentile(durationsHours, 50)),
        p90_hours: round1(percentile(durationsHours, 90))
      },
      dispute_pipeline: {
        open_nebras_disputes: openNebrasDisputes,
        open_fintech_billing_escalations: openFintechEscalations
      },
      last_run: last
        ? {
            run_id: last.run_id,
            status: last.status,
            completed_at: last.created_at,
            line_count_total: last.line_count_total ?? 0,
            line_count_matched: last.line_count_matched ?? 0,
            pass_rate_pct: round1(passRate(last))
          }
        : null,
      // Daily cadence (BACKOFFICE-01); the next scheduled run is one day after the last.
      next_run_estimated_at: last ? new Date(new Date(last.created_at).getTime() + DAY_MS).toISOString() : null,
      pass_rate_30d_pct: round1(passRate30d)
    }
    return { data, freshness: liveFreshness(now) }
  }
}

type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

export function reconciliationSloRoutes(service: ReconciliationSloService): Record<string, Handler> {
  return {
    'get /back-office/analytics/reconciliation-slo': async (c) => {
      try {
        const { data, freshness } = await service.view(c.get('principal'))
        return c.json({ ...dataEnvelope(data), freshness }, 200)
      } catch (e) {
        if (e instanceof ScopeDeniedError) return c.json(scopeDenialEnvelope(e.required), 403)
        throw e
      }
    }
  }
}
