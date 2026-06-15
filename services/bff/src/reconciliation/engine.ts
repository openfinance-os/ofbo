import type { Money } from '@ofbo/ports'
import { applyFeeScheduleV1, type ReconLineType } from './fee-schedule.js'

/**
 * BACKOFFICE-01 — the daily three-way reconciliation matching core. Pure and
 * deterministic: given the three source line-sets for a window it matches
 * TECHNICALLY-SUCCESSFUL calls only, applies the Commercial & Pricing Model v1.0
 * fee schedule to derive each line's expected fee, and classifies every line as
 * matched / unmatched / disputed. It produces counts (written to
 * reconciliation_log) + a per-line breakdown; break records are BACKOFFICE-02.
 *
 * The three sources (PRD §2): A = Nebras billing dataset, B = the bank's own
 * platform internal API logs, C = downstream fintech billing. B is the metering
 * of record (it carries the call count + success flag); A is what Nebras billed;
 * C ties out pass-through line types.
 */

export interface ReconWindow {
  start: string
  end: string
}

/** Source A — what Nebras billed (one aggregated fee per line). */
export interface NebrasBillingLine {
  line_ref: string
  line_type: ReconLineType
  channel: string
  client_id?: string | null
  billed_fee: Money
}

/** Source B — the bank's own metering: call count + technical success per line. */
export interface PlatformLogLine {
  line_ref: string
  line_type: ReconLineType
  channel: string
  client_id?: string | null
  call_count: number
  call_success: boolean
}

/** Source C — downstream fintech billing (pass-through line types). */
export interface FintechBillingLine {
  line_ref: string
  billed_fee: Money
}

export interface NebrasBillingSource {
  fetch(window: ReconWindow): Promise<NebrasBillingLine[]>
}
export interface PlatformLogSource {
  fetch(window: ReconWindow): Promise<PlatformLogLine[]>
}
export interface FintechBillingSource {
  fetch(window: ReconWindow): Promise<FintechBillingLine[]>
}

export type ReconClassification = 'matched' | 'unmatched' | 'disputed'

export interface ReconLineResult {
  line_ref: string
  line_type: ReconLineType
  channel: string
  client_id: string | null
  classification: ReconClassification
  expected_fee: Money | null
  nebras_fee: Money | null
  variance: Money | null
  /** Per-source line refs (A = Nebras, B = platform, C = fintech) — break records
   *  carry all three (BACKOFFICE-02). 'MISSING' marks a source with no line. */
  source_a_ref: string
  source_b_ref: string
  source_c_ref: string | null
  reason: string | null
}

export interface ReconResult {
  line_count_total: number
  line_count_matched: number
  line_count_unmatched: number
  line_count_disputed: number
  lines: ReconLineResult[]
}

export interface ReconSources {
  nebras: NebrasBillingSource
  platform: PlatformLogSource
  fintech: FintechBillingSource
}

const PASS_THROUGH: ReconLineType = 'tpp_aas_pass_through'

/**
 * Run the three-way match for a window. `openDisputeRefs` are line_refs already
 * tied to an open Nebras dispute (carried in from prior escalations) — counted
 * as disputed and excluded from the matched/unmatched decision.
 */
export async function runThreeWayReconciliation(
  sources: ReconSources,
  window: ReconWindow,
  opts: { openDisputeRefs?: ReadonlySet<string> } = {}
): Promise<ReconResult> {
  const [nebras, platform, fintech] = await Promise.all([
    sources.nebras.fetch(window),
    sources.platform.fetch(window),
    sources.fintech.fetch(window)
  ])

  const nebrasByRef = new Map(nebras.map((l) => [l.line_ref, l]))
  const fintechRefs = new Set(fintech.map((l) => l.line_ref))
  const openDisputes = opts.openDisputeRefs ?? new Set<string>()

  // Only technically-successful calls are reconciled — Nebras bills successful
  // calls only, so failed calls in the platform log are out of the universe.
  const successfulPlatform = platform.filter((l) => l.call_success)
  const platformByRef = new Map(successfulPlatform.map((l) => [l.line_ref, l]))

  // Universe = successful platform refs ∪ Nebras refs (a Nebras-only line is a
  // charge the bank has no metering for — a genuine unmatched).
  const universe = new Set<string>([...platformByRef.keys(), ...nebrasByRef.keys()])

  const lines: ReconLineResult[] = []
  for (const ref of universe) {
    const p = platformByRef.get(ref)
    const n = nebrasByRef.get(ref)
    const lineType = (p?.line_type ?? n?.line_type)!
    const channel = (p?.channel ?? n?.channel)!

    const base = (classification: ReconClassification, expected: Money | null, variance: Money | null, reason: string | null): ReconLineResult => ({
      line_ref: ref,
      line_type: lineType,
      channel,
      client_id: p?.client_id ?? n?.client_id ?? null,
      classification,
      expected_fee: expected,
      nebras_fee: n?.billed_fee ?? null,
      variance,
      source_a_ref: n?.line_ref ?? 'MISSING',
      source_b_ref: p?.line_ref ?? 'MISSING',
      source_c_ref: fintechRefs.has(ref) ? ref : null,
      reason
    })

    if (openDisputes.has(ref)) {
      lines.push(base('disputed', null, null, 'open_nebras_dispute'))
      continue
    }
    if (!n) {
      lines.push(base('unmatched', p ? applyFeeScheduleV1(lineType, p.call_count) : null, null, 'missing_nebras_line'))
      continue
    }
    if (!p) {
      lines.push(base('unmatched', null, null, 'missing_platform_line'))
      continue
    }
    const expected = applyFeeScheduleV1(lineType, p.call_count)
    // nebras_fees is a pass-through: matched on presence in both sources.
    if (expected === null) {
      lines.push(base('matched', null, null, null))
      continue
    }
    // Pass-through line types must also tie out against fintech billing (source C).
    if (lineType === PASS_THROUGH && !fintechRefs.has(ref)) {
      lines.push(base('unmatched', expected, null, 'missing_fintech_line'))
      continue
    }
    if (n.billed_fee.amount !== expected.amount || n.billed_fee.currency !== expected.currency) {
      const variance: Money = { amount: n.billed_fee.amount - expected.amount, currency: expected.currency }
      lines.push(base('unmatched', expected, variance, 'fee_variance'))
      continue
    }
    lines.push(base('matched', expected, null, null))
  }

  return {
    line_count_total: lines.length,
    line_count_matched: lines.filter((l) => l.classification === 'matched').length,
    line_count_unmatched: lines.filter((l) => l.classification === 'unmatched').length,
    line_count_disputed: lines.filter((l) => l.classification === 'disputed').length,
    lines
  }
}
