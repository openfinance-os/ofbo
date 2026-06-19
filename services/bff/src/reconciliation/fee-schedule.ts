/**
 * BACKOFFICE-01 — Commercial & Pricing Model v1.0 fee schedule. Per-call rates
 * are sub-fil (e.g. 2.5 fils, 0.025 fils), so the schedule is expressed in
 * milli-fils (1 fil = 1000 milli-fils) and applied to the AGGREGATED call count
 * for a billing line — aggregated lines settle to an integer number of fils
 * (the PRD's "aggregated lines stay integer"). AED minor unit is the fil.
 *
 * Rates (PRD §7.1 BACKOFFICE-01):
 *   payment initiation              2.5  fils / call         = 2500 milli-fils
 *   balance / CoP-with-payment      0.5  fils / call         =  500 milli-fils
 *   data sharing                    2.5  fils / 100 lines    =   25 milli-fils / line
 * The CoP-with-payment bundling-window duration is flagged uncertain in the PRD
 * ("verify against current scheme docs"); only the per-call rate is modelled here.
 */

import type { Money } from '@ofbo/ports'

export type ReconLineType = 'nebras_fees' | 'payment_settlement' | 'consent_record' | 'tpp_aas_pass_through' | 'lfi_access_log' | 'dao_api_call'

interface FeeRate {
  /** Rate in milli-fils (thousandths of a fil) per chargeable unit. */
  milli_fils: number
}

/** Line types whose fee follows the pricing model. `nebras_fees` is the Nebras
 *  charge line itself — a pass-through with no bank-computed expectation. */
export const FEE_SCHEDULE_V1: Record<Exclude<ReconLineType, 'nebras_fees'>, FeeRate> = {
  payment_settlement: { milli_fils: 2500 }, // 2.5 fils per payment initiation
  consent_record: { milli_fils: 500 }, // 0.5 fils per balance / CoP-with-payment
  lfi_access_log: { milli_fils: 25 }, // data sharing: 2.5 fils / 100 lines
  tpp_aas_pass_through: { milli_fils: 25 }, // data sharing pass-through to the consuming TPP
  // BACKOFFICE-68 — Dynamic Account Opening API calls priced at the data-sharing rate
  // as default until DAO volumes are observed (PRD §7).
  dao_api_call: { milli_fils: 25 }
}

export const AED = 'AED'

/**
 * Expected aggregated fee for a billing line in integer fils (AED minor units),
 * or null for `nebras_fees` (pass-through — the bank takes the Nebras charge as
 * billed). Throws if the call count does not aggregate to whole fils, which the
 * pricing model + aggregation guarantee — a fractional result means corrupt input.
 */
export function applyFeeScheduleV1(lineType: ReconLineType, callCount: number): Money | null {
  if (lineType === 'nebras_fees') return null
  const rate = FEE_SCHEDULE_V1[lineType]
  const milliFils = rate.milli_fils * callCount
  if (milliFils % 1000 !== 0) {
    throw new Error(`fee schedule produced ${milliFils} milli-fils for ${lineType}×${callCount} — not whole fils (corrupt billing input)`)
  }
  return { amount: milliFils / 1000, currency: AED }
}
