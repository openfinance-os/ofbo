/**
 * BACKOFFICE-58 — SLO observability for the Operations Console. Surfaces, per SLO,
 * the target, observed attainment, error-budget remaining and burn rate so operators
 * see service health WITHOUT a separate APM login (the data rides the platform's own
 * OTel/APM stream). Pure computation here; the demo reader is deterministic and the
 * enterprise adapter feeds real observed attainment.
 */

export interface SloObservation {
  key: string
  description: string
  /** SLO target attainment over the window, e.g. 99.9 (%). */
  target_pct: number
  /** Observed attainment over the window (%). */
  observed_pct: number
  window_days: number
}

export interface SloStatus extends SloObservation {
  /** % of the error budget still available (100 = untouched, 0 = exhausted). */
  error_budget_remaining_pct: number
  /** Consumed ÷ allowed over the window — >1 means the budget is overspent. */
  burn_rate: number
  status: 'healthy' | 'at_risk' | 'breach'
}

export interface SloReader {
  getSloObservations(): Promise<SloObservation[]>
}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi)

/** Error budget = the allowed failure (100 − target). Consumed = observed failure
 *  (100 − observed). Remaining = (allowed − consumed) / allowed; burn = consumed / allowed. */
export function computeSlo(o: SloObservation): SloStatus {
  const allowed = Math.max(0, 100 - o.target_pct)
  const consumed = Math.max(0, 100 - o.observed_pct)
  const remaining = allowed <= 0 ? 100 : clamp(((allowed - consumed) / allowed) * 100, 0, 100)
  const burn = allowed <= 0 ? 0 : Number((consumed / allowed).toFixed(3))
  const status: SloStatus['status'] = remaining <= 0 ? 'breach' : remaining < 25 ? 'at_risk' : 'healthy'
  return { ...o, error_budget_remaining_pct: Number(remaining.toFixed(2)), burn_rate: burn, status }
}

export function summarizeSlos(slos: SloStatus[]): { healthy: number; at_risk: number; breach: number } {
  return {
    healthy: slos.filter((s) => s.status === 'healthy').length,
    at_risk: slos.filter((s) => s.status === 'at_risk').length,
    breach: slos.filter((s) => s.status === 'breach').length
  }
}

/** Deterministic demo SLOs (healthy / at-risk / breach mix) over a 30-day window. */
export class DemoSloReader implements SloReader {
  async getSloObservations(): Promise<SloObservation[]> {
    return [
      { key: 'nebras_propagation_5s', description: 'Nebras consent-revoke propagation < 5s (NFR-18)', target_pct: 99.0, observed_pct: 99.6, window_days: 30 },
      { key: 'reconciliation_completeness', description: 'Daily three-way reconciliation completeness', target_pct: 99.9, observed_pct: 99.97, window_days: 30 },
      { key: 'nebras_connectivity_uptime', description: 'Nebras Hub connectivity uptime', target_pct: 99.5, observed_pct: 99.55, window_days: 30 },
      { key: 'api_p95_latency', description: 'Back Office API p95 < 1.5s', target_pct: 99.5, observed_pct: 99.3, window_days: 30 }
    ]
  }
}
