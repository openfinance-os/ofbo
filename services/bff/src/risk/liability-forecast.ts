import type { ItsmPort } from '@ofbo/ports'
import { liabilityAmount, type LiableParty, type LiabilitySignalSink } from './liability.js'

/**
 * BACKOFFICE-65 — predictive liability forecasting (regulated AI artefact).
 *
 * A 24-hour-ahead probability of a liability-threshold crossing per (issue × liable
 * party), inferred from ≥90 days of liability telemetry. The model is intentionally a
 * DETERMINISTIC, EXPLAINABLE estimator — an exponentially-weighted incident rate fed
 * through a Poisson crossing probability — not a black-box ML system: every output
 * carries its input features, and the whole thing is reproducible (no RNG, no training
 * infra). It composes on existing primitives — it emits the already-contracted
 * predictive_liability_forecast risk signal and rides the existing
 * nebras-liability-monitor AnalyticsView; no new endpoint, schema, or table.
 *
 * Regulated-AI governance (PRD §7 "regulated AI artefact"):
 *   • Model card — docs/model-cards/predictive-liability-forecast.md, plus the inline
 *     `model` block (version, method, training window, recertification date).
 *   • Drift monitoring — a rolling backtest (predict day N from days <N, compare to the
 *     actual) yields a drift score + status surfaced on every view.
 *   • Recertification — the model carries a recertify_by date; once past it the model is
 *     deemed uncertified and the deterministic BACKOFFICE-36 threshold monitor remains
 *     authoritative (fallback_active), with no predictive signals emitted.
 *
 * No PSU PII: telemetry is keyed only by liability class + party (LFI/TPP), never by PSU.
 */

export const LIABILITY_FORECAST_SCOPE = 'risk:read'
export const MODEL_VERSION = 'liability-forecast-v1.0.0'
export const MODEL_METHOD = 'ewma-rate + poisson-crossing-probability (deterministic)'
export const FORECAST_HORIZON_HOURS = 24
export const MIN_TELEMETRY_DAYS = 90
export const HIGH_PROBABILITY_THRESHOLD = 0.7
export const RECERTIFICATION_INTERVAL_DAYS = 90
/** Drift tolerance on the normalised rolling-backtest mean-absolute error. */
export const DRIFT_TOLERANCE = 0.5
/** EWMA smoothing — responsive (half-life ~1 day) to favour recent behaviour for a 24h horizon. */
export const EWMA_ALPHA = 0.5

const DAY_MS = 86_400_000
const RUN_PRINCIPAL = 'system:liability-forecast-monitor'

export interface Money {
  amount: number
  currency: string
}

export interface LiabilityTelemetryPoint {
  date: string // YYYY-MM-DD
  issue: string
  liable_party: LiableParty
  incident_count: number
}

export interface LiabilityTelemetrySource {
  getDailyTelemetry(days: number, now: Date): Promise<LiabilityTelemetryPoint[]>
}

export interface ClassForecast {
  issue: string
  liable_party: LiableParty
  horizon_hours: number
  probability: number
  expected_incidents: number
  expected_accrual: Money
  severity: 'low' | 'medium' | 'high' | 'critical'
  ref: string
  high: boolean
  features: { ewma_daily_rate: number; observed_days: number; recent_incidents_7d: number }
}

export interface ModelCardMeta {
  model_version: string
  method: string
  horizon_hours: number
  min_telemetry_days: number
  high_probability_threshold: number
  ewma_alpha: number
  trained_through: string | null
  recertify_by: string | null
  recertification_overdue: boolean
  model_card_uri: string
}

export interface DriftSummary {
  status: 'ok' | 'warn' | 'breach'
  score: number
  mean_abs_error: number
  backtest_points: number
}

export interface ForecastView {
  model: ModelCardMeta
  drift: DriftSummary
  forecasts: ClassForecast[]
  fallback_active: boolean
  generated_at: string
}

const round = (n: number, dp = 4): number => {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

/** Exponentially-weighted mean of a daily-count series (oldest→newest); recent weighted more. */
export function ewmaRate(counts: number[], alpha = EWMA_ALPHA): number {
  if (counts.length === 0) return 0
  let s = counts[0]!
  for (let i = 1; i < counts.length; i++) s = alpha * counts[i]! + (1 - alpha) * s
  return s
}

/** Poisson P(≥1 incident within the horizon) given a daily rate. 0 at rate 0, →1 as rate→∞. */
export function crossingProbability(dailyRate: number, horizonHours: number): number {
  if (dailyRate <= 0) return 0
  return 1 - Math.exp(-dailyRate * (horizonHours / 24))
}

function forecastSeverity(probability: number, accruedAed: number): ClassForecast['severity'] {
  if (probability >= 0.85 || accruedAed >= 5000) return 'critical'
  if (probability >= HIGH_PROBABILITY_THRESHOLD || accruedAed >= 1000) return 'high'
  if (probability >= 0.4 || accruedAed >= 500) return 'medium'
  return 'low'
}

function classKey(issue: string, party: LiableParty): string {
  return `${issue}|${party}`
}

/** Forecast one class from its ordered daily incident counts. */
export function forecastClass(issue: string, liable_party: LiableParty, counts: number[]): ClassForecast {
  const rate = ewmaRate(counts)
  const probability = crossingProbability(rate, FORECAST_HORIZON_HOURS)
  const expected_incidents = rate * (FORECAST_HORIZON_HOURS / 24)
  const perIncidentAed = liabilityAmount({ issue })
  const expectedAed = perIncidentAed * expected_incidents
  const recent7 = counts.slice(-7).reduce((a, b) => a + b, 0)
  return {
    issue,
    liable_party,
    horizon_hours: FORECAST_HORIZON_HOURS,
    probability: round(probability),
    expected_incidents: round(expected_incidents),
    // Money: integer minor units (fils; AED has 100 minor units).
    expected_accrual: { amount: Math.round(expectedAed * 100), currency: 'AED' },
    severity: forecastSeverity(probability, expectedAed),
    ref: `${issue}|${liable_party}|forecast`,
    high: probability >= HIGH_PROBABILITY_THRESHOLD,
    features: { ewma_daily_rate: round(rate), observed_days: counts.length, recent_incidents_7d: recent7 }
  }
}

/** Rolling-backtest drift: predict each recent day from the days before it, compare to actual. */
function backtestDrift(seriesByClass: number[][]): DriftSummary {
  const errs: number[] = []
  let actualSum = 0
  let actualN = 0
  for (const counts of seriesByClass) {
    const window = Math.min(14, counts.length - 1)
    for (let k = counts.length - window; k < counts.length; k++) {
      if (k < 1) continue
      const predicted = ewmaRate(counts.slice(0, k))
      const actual = counts[k]!
      errs.push(Math.abs(predicted - actual))
      actualSum += actual
      actualN++
    }
  }
  const mae = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : 0
  const meanActual = actualN ? actualSum / actualN : 0
  const score = mae / (1 + meanActual)
  const status: DriftSummary['status'] = score <= DRIFT_TOLERANCE ? 'ok' : score <= 2 * DRIFT_TOLERANCE ? 'warn' : 'breach'
  return { status, score: round(score), mean_abs_error: round(mae), backtest_points: errs.length }
}

function addDays(isoDate: string, days: number): string {
  return new Date(new Date(`${isoDate}T00:00:00.000Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10)
}

export interface LiabilityForecastServiceDeps {
  telemetry: LiabilityTelemetrySource
  now?: () => Date
}

export class LiabilityForecastService {
  private readonly now: () => Date
  constructor(private readonly deps: LiabilityForecastServiceDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  /** Compute the forecast view. `asOf` is the evaluation/query time (defaults to now);
   *  telemetry is anchored to the training clock, so recertification advances with asOf. */
  async forecastView(asOf?: Date): Promise<ForecastView> {
    const trainedAt = this.now()
    const queryNow = asOf ?? this.now()
    const telemetry = await this.deps.telemetry.getDailyTelemetry(MIN_TELEMETRY_DAYS, trainedAt)

    // group by class, ordered by date
    const byClass = new Map<string, LiabilityTelemetryPoint[]>()
    let trainedThrough: string | null = null
    for (const p of telemetry) {
      const k = classKey(p.issue, p.liable_party)
      ;(byClass.get(k) ?? byClass.set(k, []).get(k)!).push(p)
      if (!trainedThrough || p.date > trainedThrough) trainedThrough = p.date
    }

    const seriesByClass: number[][] = []
    const forecasts: ClassForecast[] = []
    for (const points of byClass.values()) {
      const ordered = [...points].sort((a, b) => a.date.localeCompare(b.date))
      const counts = ordered.map((p) => p.incident_count)
      seriesByClass.push(counts)
      forecasts.push(forecastClass(ordered[0]!.issue, ordered[0]!.liable_party, counts))
    }
    forecasts.sort((a, b) => b.probability - a.probability || a.ref.localeCompare(b.ref))

    const recertifyBy = trainedThrough ? addDays(trainedThrough, RECERTIFICATION_INTERVAL_DAYS) : null
    const recertificationOverdue = recertifyBy ? queryNow.toISOString().slice(0, 10) > recertifyBy : false

    const model: ModelCardMeta = {
      model_version: MODEL_VERSION,
      method: MODEL_METHOD,
      horizon_hours: FORECAST_HORIZON_HOURS,
      min_telemetry_days: MIN_TELEMETRY_DAYS,
      high_probability_threshold: HIGH_PROBABILITY_THRESHOLD,
      ewma_alpha: EWMA_ALPHA,
      trained_through: trainedThrough,
      recertify_by: recertifyBy,
      recertification_overdue: recertificationOverdue,
      model_card_uri: 'docs/model-cards/predictive-liability-forecast.md'
    }
    return {
      model,
      drift: backtestDrift(seriesByClass),
      forecasts,
      // Uncertified model → the deterministic BACKOFFICE-36 threshold monitor is authoritative.
      fallback_active: recertificationOverdue,
      generated_at: queryNow.toISOString()
    }
  }
}

export interface LiabilityForecastMonitorDeps {
  telemetry: LiabilityTelemetrySource
  signals: LiabilitySignalSink
  itsm?: Pick<ItsmPort, 'createTicket'>
  now?: () => Date
}

export interface ForecastMonitorResult {
  emitted: ClassForecast[]
  fallback_active: boolean
  drift: DriftSummary
}

/**
 * Headless monitor (worker scheduled). When the model is certified, it raises a
 * predictive_liability_forecast risk signal for each high-probability class (deduped
 * against open refs). When the model is in fallback (recertification overdue) it emits
 * NO predictive signals and instead raises a recertification ITSM ticket — the
 * deterministic BACKOFFICE-36 monitor remains the authority.
 */
export class LiabilityForecastMonitor {
  private readonly now: () => Date
  private readonly service: LiabilityForecastService
  constructor(private readonly deps: LiabilityForecastMonitorDeps) {
    this.now = deps.now ?? (() => new Date())
    this.service = new LiabilityForecastService({ telemetry: deps.telemetry, now: this.now })
  }

  async run(traceId: string, openRefs: Set<string> = new Set()): Promise<ForecastMonitorResult> {
    const view = await this.service.forecastView(this.now())

    if (view.fallback_active) {
      await this.deps.itsm?.createTicket(
        {
          type: 'liability_forecast_recertification',
          severity: 'high',
          team: 'risk',
          summary: `Predictive liability model uncertified (recertify_by ${view.model.recertify_by}) — deterministic threshold monitor authoritative; recertification required.`
        },
        { trace_id: traceId }
      )
      return { emitted: [], fallback_active: true, drift: view.drift }
    }

    if (view.drift.status === 'breach') {
      await this.deps.itsm?.createTicket(
        {
          type: 'liability_forecast_drift',
          severity: 'medium',
          team: 'risk',
          summary: `Predictive liability model drift ${view.drift.status} (score ${view.drift.score}) — recertification recommended.`
        },
        { trace_id: traceId }
      )
    }

    const emitted: ClassForecast[] = []
    for (const f of view.forecasts) {
      if (!f.high || openRefs.has(f.ref)) continue
      const summary = `Predictive liability forecast: ${f.issue} (${f.liable_party}) ${Math.round(f.probability * 100)}% chance of a threshold crossing in ${f.horizon_hours}h (expected AED ${f.expected_accrual.amount / 100}).`
      await this.deps.signals.record({
        signal_type: 'predictive_liability_forecast',
        severity: f.severity,
        acting_principal: RUN_PRINCIPAL,
        summary,
        trace_id: traceId,
        nebras_liability_event_ref: f.ref
      })
      await this.deps.itsm?.createTicket({ type: 'predictive_liability_forecast', severity: f.severity, team: 'risk', summary }, { trace_id: traceId })
      openRefs.add(f.ref)
      emitted.push(f)
    }
    return { emitted, fallback_active: false, drift: view.drift }
  }
}

/**
 * Deterministic demo telemetry: ≥90 days of daily incident counts for the v2.1 liability
 * classes, seeded by a pure hash of (date, issue, party) — no RNG, fully reproducible.
 */
export class DemoLiabilityTelemetrySource implements LiabilityTelemetrySource {
  private static readonly CLASSES: { issue: string; liable_party: LiableParty }[] = [
    { issue: 'consent_state_failure', liable_party: 'LFI' },
    { issue: 'sla_execution_failure', liable_party: 'LFI' },
    { issue: 'fraud_prevention_failure', liable_party: 'TPP' }
  ]

  private static seed(s: string): number {
    let h = 2166136261
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    return (h >>> 0) % 100
  }

  async getDailyTelemetry(days: number, now: Date): Promise<LiabilityTelemetryPoint[]> {
    const out: LiabilityTelemetryPoint[] = []
    const n = Math.max(days, MIN_TELEMETRY_DAYS)
    for (let i = n; i >= 1; i--) {
      const date = new Date(now.getTime() - i * DAY_MS).toISOString().slice(0, 10)
      for (const c of DemoLiabilityTelemetrySource.CLASSES) {
        const seed = DemoLiabilityTelemetrySource.seed(`${date}|${c.issue}|${c.liable_party}`)
        // smooth baseline ~1/day with an occasional 2 — keeps drift within tolerance.
        const incident_count = seed % 5 === 0 ? 2 : 1
        out.push({ date, issue: c.issue, liable_party: c.liable_party, incident_count })
      }
    }
    return out
  }
}
