/**
 * VAL-01 (ADR 0026) — the scheme liability schedule, in AED MINOR units.
 *
 * This is the single source of truth for what one scheme incident costs. Two consumers read
 * it: the BACKOFFICE-36 Nebras liability monitor (exposure the bank is ACCRUING) and the
 * VAL-01 exposure-avoided KPI (exposure the bank did NOT incur because a control held).
 * Both must quote the same numbers — a regulated fee table maintained in two places drifts
 * silently, and the drift only surfaces when a figure is already wrong in front of a
 * regulator. `risk/liability.ts` therefore DERIVES its whole-AED matrix from this file
 * rather than restating it.
 *
 * Minor units (fils) are the storage form per the CLAUDE.md money convention — integer minor
 * units + ISO 4217 — so these compose with `variance_amount` and the fee accruals without a
 * float conversion anywhere in the path.
 */

/** Cited so the amounts are attributable, per VAL-01 acceptance criterion 1. */
export const LIABILITY_SCHEDULE_CITATION =
  'CBUAE Limitation of Liability Model v2.1, per-incident amounts (PRD §7 BACKOFFICE-36)'

export type LiabilityIssue =
  | 'consent_state_failure'
  | 'revocation_failure'
  | 'sca_auth_error'
  | 'data_breach'
  | 'sla_execution_failure'
  | 'consumer_protection_violation'
  | 'deprecation_mismanagement'
  | 'lfi_breaking_change'
  | 'fraud_prevention_failure'

/** Per-incident scheme amounts, AED minor units (fils). See LIABILITY_SCHEDULE_CITATION. */
export const LIABILITY_SCHEDULE_MINOR: Record<LiabilityIssue, number> = {
  consent_state_failure: 50_000,
  revocation_failure: 35_000,
  sca_auth_error: 50_000,
  data_breach: 75_000,
  // Tiered by delay severity — the flat entry is tier 1 (worst). See LIABILITY_SLA_TIERS_MINOR.
  sla_execution_failure: 35_000,
  consumer_protection_violation: 100_000,
  deprecation_mismanagement: 250_000,
  lfi_breaking_change: 500_000,
  fraud_prevention_failure: 1_000_000
}

/** SLA-execution failure is tiered 350/250/200 AED by delay severity (v2.1), in minor units. */
export const LIABILITY_SLA_TIERS_MINOR: Record<number, number> = {
  1: 35_000,
  2: 25_000,
  3: 20_000
}

/**
 * The per-incident amount in AED minor units. Unknown issues return 0 rather than throwing:
 * an unrecognised issue code must not take down an analytics view, and a silent 0 is visible
 * in the breakdown (a category that contributes nothing) rather than inventing an amount.
 */
export function liabilityAmountMinor(issue: LiabilityIssue, slaTier?: number): number {
  if (issue === 'sla_execution_failure') {
    return LIABILITY_SLA_TIERS_MINOR[slaTier ?? 1] ?? LIABILITY_SLA_TIERS_MINOR[1]!
  }
  return LIABILITY_SCHEDULE_MINOR[issue] ?? 0
}
