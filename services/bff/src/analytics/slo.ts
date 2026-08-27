import { NEBRAS_SLA_SECONDS } from '../consents/nebras-sla.js'
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
      // Description DERIVED from the enforced constant (STD-09). It used to restate the
      // threshold as prose in a different unit, so a scheme amendment could move what the code
      // enforces while this row kept telling operators the old number.
      //
      // The KEY carries no threshold either. It was `nebras_propagation_5s`, which is the same
      // defect in the one field with identifier semantics — the field consumers match on, where a
      // stale number is worse than in prose: an amendment to 3s would have produced a row keyed
      // `…_5s` and described as "< 3s". Deriving the key instead would have been worse again,
      // since the identifier would then CHANGE under consumers on a scheme amendment. An
      // identifier should not encode a value that can move, so it names the SLO and the
      // description carries the number.
      //
      // THIS IS A BREAKING IDENTIFIER CHANGE and nothing could have stopped it: the contract
      // enumerates no SLO keys, so `slo.slos[].key` is a live wire surface with no schema behind
      // it. A repo-wide grep for the old key found only this file and its test — no screen, export
      // template, adapter or fixture — so nothing in-repo is left stale. An out-of-repo consumer
      // (an APM dashboard, a P5 adapter mapping) would break silently, which is the actual
      // exposure. Recorded here because there is no contract to record it in; enumerating the key
      // set so the NEXT rename is visible is BACKOFFICE-91.
      { key: 'nebras_propagation_sla', description: `Nebras consent-revoke propagation < ${NEBRAS_SLA_SECONDS}s (NFR-18)`, target_pct: 99.0, observed_pct: 99.6, window_days: 30 },
      { key: 'reconciliation_completeness', description: 'Daily three-way reconciliation completeness', target_pct: 99.9, observed_pct: 99.97, window_days: 30 },
      { key: 'nebras_connectivity_uptime', description: 'Nebras Hub connectivity uptime', target_pct: 99.5, observed_pct: 99.55, window_days: 30 },
      { key: 'api_p95_latency', description: 'Back Office API p95 < 1.5s', target_pct: 99.5, observed_pct: 99.3, window_days: 30 }
    ]
  }
}
