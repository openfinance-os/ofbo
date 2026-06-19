import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { FAPI_HEADERS } from './helpers.js'
import {
  MODEL_VERSION,
  FORECAST_HORIZON_HOURS,
  MIN_TELEMETRY_DAYS,
  crossingProbability,
  ewmaRate,
  DemoLiabilityTelemetrySource,
  LiabilityForecastService,
  LiabilityForecastMonitor,
  type LiabilityTelemetryPoint
} from '../src/risk/liability-forecast.js'

/**
 * BACKOFFICE-65 — predictive liability forecasting (regulated AI artefact).
 * 24h-ahead liability probability per (issue × liable party) from ≥90 days telemetry;
 * deterministic explainable model + model card + drift monitoring + recertification;
 * the BACKOFFICE-36 threshold monitor remains the deterministic fallback.
 */

const NOW = new Date('2026-06-19T00:00:00.000Z')

class FakeSink {
  signals: { signal_type: string; severity: string; nebras_liability_event_ref?: string; summary: string }[] = []
  async record(e: { signal_type: string; severity: string; acting_principal: string; summary: string; trace_id: string; nebras_liability_event_ref?: string }) {
    this.signals.push({ signal_type: e.signal_type, severity: e.severity, nebras_liability_event_ref: e.nebras_liability_event_ref, summary: e.summary })
  }
}
class FakeItsm {
  tickets: { team: string; type: string }[] = []
  async createTicket(input: { type: string; severity: string; team: string; summary: string }) {
    this.tickets.push({ team: input.team, type: input.type })
    return { ticket_id: `tk-${this.tickets.length}` }
  }
}

describe('forecast model — pure functions', () => {
  it('crossingProbability is monotonic in rate, in [0,1), and 0 at rate 0', () => {
    expect(crossingProbability(0, FORECAST_HORIZON_HOURS)).toBe(0)
    const p1 = crossingProbability(0.2, FORECAST_HORIZON_HOURS)
    const p2 = crossingProbability(1.0, FORECAST_HORIZON_HOURS)
    const p3 = crossingProbability(5.0, FORECAST_HORIZON_HOURS)
    expect(p1).toBeGreaterThan(0)
    expect(p2).toBeGreaterThan(p1)
    expect(p3).toBeGreaterThan(p2)
    expect(p3).toBeLessThan(1)
  })

  it('ewmaRate weights recent observations more heavily', () => {
    const flat = ewmaRate([1, 1, 1, 1])
    expect(flat).toBeCloseTo(1, 5)
    const rising = ewmaRate([0, 0, 0, 5]) // recent spike
    const falling = ewmaRate([5, 0, 0, 0]) // old spike
    expect(rising).toBeGreaterThan(falling)
  })
})

describe('DemoLiabilityTelemetrySource', () => {
  it('produces ≥90 days of deterministic per-class telemetry', async () => {
    const a = await new DemoLiabilityTelemetrySource().getDailyTelemetry(MIN_TELEMETRY_DAYS, NOW)
    const b = await new DemoLiabilityTelemetrySource().getDailyTelemetry(MIN_TELEMETRY_DAYS, NOW)
    expect(a).toEqual(b) // deterministic, no RNG
    const days = new Set(a.map((p) => p.date))
    expect(days.size).toBeGreaterThanOrEqual(MIN_TELEMETRY_DAYS)
    expect(a.every((p) => p.liable_party === 'LFI' || p.liable_party === 'TPP')).toBe(true)
  })
})

describe('LiabilityForecastService.forecastView', () => {
  it('returns a model card, per-class forecasts, drift, and no fallback for fresh telemetry', async () => {
    const svc = new LiabilityForecastService({ telemetry: new DemoLiabilityTelemetrySource(), now: () => NOW })
    const view = await svc.forecastView()
    expect(view.model.model_version).toBe(MODEL_VERSION)
    expect(view.model.horizon_hours).toBe(FORECAST_HORIZON_HOURS)
    expect(view.model.recertification_overdue).toBe(false)
    expect(view.fallback_active).toBe(false)
    expect(view.forecasts.length).toBeGreaterThan(0)
    const f = view.forecasts[0]!
    expect(f.probability).toBeGreaterThanOrEqual(0)
    expect(f.probability).toBeLessThan(1)
    expect(f.horizon_hours).toBe(FORECAST_HORIZON_HOURS)
    expect(f.expected_accrual.currency).toBe('AED') // Money: integer minor units
    expect(Number.isInteger(f.expected_accrual.amount)).toBe(true)
    expect(f.features.observed_days).toBeGreaterThanOrEqual(1)
    expect(['low', 'medium', 'high', 'critical']).toContain(f.severity)
    expect(view.drift.status).toMatch(/ok|warn|breach/)
  })

  it('flags recertification overdue + activates the deterministic fallback when the model is stale', async () => {
    const svc = new LiabilityForecastService({ telemetry: new DemoLiabilityTelemetrySource(), now: () => NOW })
    // 200 days after the telemetry → past the recertification horizon
    const stale = await svc.forecastView(new Date('2026-12-31T00:00:00.000Z'))
    expect(stale.model.recertification_overdue).toBe(true)
    expect(stale.fallback_active).toBe(true)
  })
})

describe('LiabilityForecastMonitor (headless)', () => {
  // a class with a high recent incident rate → high 24h probability
  const hot: LiabilityTelemetryPoint[] = Array.from({ length: MIN_TELEMETRY_DAYS }, (_, i) => ({
    date: new Date(NOW.getTime() - (MIN_TELEMETRY_DAYS - i) * 86400000).toISOString().slice(0, 10),
    issue: 'fraud_prevention_failure',
    liable_party: 'TPP' as const,
    incident_count: i >= MIN_TELEMETRY_DAYS - 7 ? 3 : 1 // recent burst
  }))
  const hotSource = { getDailyTelemetry: async () => hot }

  it('emits a predictive_liability_forecast signal for a high-probability class (deduped)', async () => {
    const signals = new FakeSink()
    const itsm = new FakeItsm()
    const mon = new LiabilityForecastMonitor({ telemetry: hotSource, signals, itsm, now: () => NOW })
    const open = new Set<string>()
    const r1 = await mon.run('trace-1', open)
    const pred = signals.signals.filter((s) => s.signal_type === 'predictive_liability_forecast')
    expect(pred.length).toBeGreaterThanOrEqual(1)
    expect(r1.fallback_active).toBe(false)
    // dedup: a second run with the same open refs emits nothing new
    const before = signals.signals.length
    await mon.run('trace-2', open)
    expect(signals.signals.length).toBe(before)
  })

  it('suppresses forecast signals and raises a governance signal when recertification is overdue', async () => {
    const signals = new FakeSink()
    const itsm = new FakeItsm()
    const mon = new LiabilityForecastMonitor({ telemetry: hotSource, signals, itsm, now: () => new Date('2026-12-31T00:00:00.000Z') })
    const r = await mon.run('trace-3', new Set<string>())
    expect(r.fallback_active).toBe(true)
    expect(signals.signals.some((s) => s.signal_type === 'predictive_liability_forecast')).toBe(false)
    expect(itsm.tickets.length).toBeGreaterThanOrEqual(1) // recertification escalation
  })
})

describe('GET /back-office/analytics/nebras-liability-monitor — forecast block', () => {
  it('folds the predictive forecast into the liability view (risk:read)', async () => {
    const app = createApp({})
    const res = await app.request('/back-office/analytics/nebras-liability-monitor', {
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:risk-analyst' }
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { forecast?: { model?: { model_version?: string }; forecasts?: unknown[] } } }
    expect(body.data.forecast).toBeDefined()
    expect(body.data.forecast!.model!.model_version).toBe(MODEL_VERSION)
    expect(Array.isArray(body.data.forecast!.forecasts)).toBe(true)
  })

  it('still denies a non-risk persona (403)', async () => {
    const app = createApp({})
    const res = await app.request('/back-office/analytics/nebras-liability-monitor', {
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst' }
    })
    expect(res.status).toBe(403)
  })
})
