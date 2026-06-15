import type { ReconLineType } from './fee-schedule.js'

/**
 * BACKOFFICE-02 — configurable break thresholds per fee class. A variance is a
 * break when it EXCEEDS (strictly >) the class threshold. Defaults (PRD §4 /
 * BACKOFFICE-02): >1 fils fee variance, >0 consent-count drift. The user-facing
 * GET/PUT thresholds API is BACKOFFICE-12; here the defaults drive detection and
 * a caller may pass an override set.
 */

export type ThresholdUnit = 'aed' | 'count'

export interface BreakThreshold {
  fee_class: ReconLineType
  /** Integer minor units (fils) when unit=aed; a plain count when unit=count. */
  threshold_value: number
  unit: ThresholdUnit
}

/** consent_record drift is counted (unit=count, default 0); every other class is
 *  a fee variance in fils (unit=aed, default 1). */
export const DEFAULT_THRESHOLDS: BreakThreshold[] = [
  { fee_class: 'nebras_fees', threshold_value: 1, unit: 'aed' },
  { fee_class: 'payment_settlement', threshold_value: 1, unit: 'aed' },
  { fee_class: 'tpp_aas_pass_through', threshold_value: 1, unit: 'aed' },
  { fee_class: 'lfi_access_log', threshold_value: 1, unit: 'aed' },
  { fee_class: 'consent_record', threshold_value: 0, unit: 'count' }
]

export function thresholdFor(lineType: ReconLineType, thresholds: BreakThreshold[] = DEFAULT_THRESHOLDS): BreakThreshold {
  return thresholds.find((t) => t.fee_class === lineType) ?? { fee_class: lineType, threshold_value: 1, unit: 'aed' }
}
