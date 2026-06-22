import type { Money } from '@ofbo/ports'
import { applyFeeScheduleV1, AED, type ReconLineType } from './fee-schedule.js'
import { productFamily, type ProductFamily } from './margin.js'
import type {
  FintechBillingLine,
  FintechBillingSource,
  NebrasBillingLine,
  NebrasBillingSource,
  PlatformLogLine,
  PlatformLogSource,
  ReconWindow
} from './engine.js'

/**
 * BACKOFFICE-01 — deterministic synthetic reconciliation sources (demo profile).
 * The three sources tie out BY CONSTRUCTION except for explicitly injected
 * variances, so a demo can show matched/unmatched/disputed without scheme
 * connectivity. These implement the source INTERFACES; the enterprise adapters
 * (M6) back the same interfaces with the bank's metering + the P6-fetched Nebras
 * dataset. No network egress here — this is in-process synthetic data.
 *
 * Call counts are multiples of 40 so every schedule-derived fee lands on a whole
 * fil (see fee-schedule.ts).
 */

const fnv1a = (s: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Deterministic UUID v4-shaped id (consuming-TPP client_id is a uuid column). */
function deterministicUuid(seed: string): string {
  let h = 0x811c9dc5
  const out: string[] = []
  for (let i = 0; i < 32; i++) {
    h ^= seed.charCodeAt(i % seed.length) + i
    h = Math.imul(h, 0x01000193) >>> 0
    out.push((h & 0xf).toString(16))
  }
  out[12] = '4'
  out[16] = ((parseInt(out[16]!, 16) & 0x3) | 0x8).toString(16)
  const s = out.join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}

const CHANNELS = ['internal_retail', 'internal_corporate'] as const
// BACKOFFICE-68 — DAO API calls (dao_api_call) join the three-way match like any
// other data-sharing line; the engine + fee schedule + thresholds treat them uniformly.
const MATCHED_TYPES: ReconLineType[] = ['payment_settlement', 'consent_record', 'lfi_access_log', 'tpp_aas_pass_through', 'nebras_fees', 'dao_api_call']

/**
 * Per-family TPP-aaS pass-through markup (base fils/line). The bank, as TPP-of-record,
 * re-bills consuming fintechs the Nebras fee + this markup across product families —
 * SIP (payment initiation), AISP (data sharing), CoP (confirmation of payee). The markup
 * IS the bank's margin. nebras_fees/OTHER carry no re-bill. (Only PASS_THROUGH lines are
 * break-checked against source C in the engine, so re-billing other families adds margin
 * depth without changing break/match counts.)
 */
const TPP_AAS_MARKUP: Partial<Record<ProductFamily, number>> = { SIP: 6, AISP: 3, CoP: 2 }

export interface SimReconConfig {
  matchedLines?: number
  feeVarianceLines?: number
  missingNebrasLines?: number
  failedCalls?: number
  disputedLines?: number
  /** Fee perturbation (fils) applied to each injected fee-variance line. */
  variancePerLine?: number
}

const DEFAULTS: Required<SimReconConfig> = {
  matchedLines: 100,
  feeVarianceLines: 5,
  missingNebrasLines: 3,
  failedCalls: 4,
  disputedLines: 2,
  variancePerLine: 7
}

export interface SimReconSources {
  nebras: NebrasBillingSource
  platform: PlatformLogSource
  fintech: FintechBillingSource
  openDisputeRefs: Set<string>
}

interface Built {
  nebras: NebrasBillingLine[]
  platform: PlatformLogLine[]
  fintech: FintechBillingLine[]
  openDisputeRefs: Set<string>
}

function build(period: string, cfg: Required<SimReconConfig>): Built {
  const nebras: NebrasBillingLine[] = []
  const platform: PlatformLogLine[] = []
  const fintech: FintechBillingLine[] = []
  const openDisputeRefs = new Set<string>()
  const ref = (kind: string, i: number) => `recon-${period}-${kind}-${String(i).padStart(4, '0')}`
  const chan = (i: number) => CHANNELS[i % CHANNELS.length]!
  const client = (i: number) => deterministicUuid(`client:${fnv1a(`${period}:${i}`) % 8}`)

  // Matched lines: present in both sources with fees that tie out.
  for (let i = 0; i < cfg.matchedLines; i++) {
    const lineRef = ref('m', i)
    const lineType = MATCHED_TYPES[i % MATCHED_TYPES.length]!
    const count = 40 * (1 + (fnv1a(lineRef) % 5))
    const expected = applyFeeScheduleV1(lineType, count)
    const billed: Money = expected ?? { amount: 40 + (fnv1a(lineRef) % 200), currency: AED } // nebras_fees pass-through
    platform.push({ line_ref: lineRef, line_type: lineType, channel: chan(i), client_id: client(i), call_count: count, call_success: true })
    nebras.push({ line_ref: lineRef, line_type: lineType, channel: chan(i), client_id: client(i), billed_fee: billed })
    // TPP-aaS (BACKOFFICE-07): the bank re-bills the consuming fintech the Nebras fee + a
    // deterministic per-family markup — that markup is the bank's pass-through margin.
    const baseMarkup = TPP_AAS_MARKUP[productFamily(lineType)]
    if (baseMarkup) {
      const markup = baseMarkup + (fnv1a(`margin:${lineRef}`) % baseMarkup) // baseMarkup..2·baseMarkup-1 fils
      fintech.push({ line_ref: lineRef, billed_fee: { amount: billed.amount + markup, currency: AED } })
    }
  }

  // Fee-variance lines: Nebras billed differs from the schedule expectation.
  for (let i = 0; i < cfg.feeVarianceLines; i++) {
    const lineRef = ref('v', i)
    const count = 40
    const expected = applyFeeScheduleV1('payment_settlement', count)!
    platform.push({ line_ref: lineRef, line_type: 'payment_settlement', channel: chan(i), client_id: client(i), call_count: count, call_success: true })
    nebras.push({ line_ref: lineRef, line_type: 'payment_settlement', channel: chan(i), client_id: client(i), billed_fee: { amount: expected.amount + cfg.variancePerLine, currency: AED } })
  }

  // Missing-in-Nebras lines: the bank metered a successful call Nebras never billed.
  for (let i = 0; i < cfg.missingNebrasLines; i++) {
    const lineRef = ref('x', i)
    platform.push({ line_ref: lineRef, line_type: 'payment_settlement', channel: chan(i), client_id: client(i), call_count: 40, call_success: true })
  }

  // Failed calls: present in the platform log but not technically successful —
  // excluded from the reconciliation universe.
  for (let i = 0; i < cfg.failedCalls; i++) {
    platform.push({ line_ref: ref('f', i), line_type: 'payment_settlement', channel: chan(i), client_id: client(i), call_count: 40, call_success: false })
  }

  // Disputed lines: tie out, but carry an open Nebras dispute → counted disputed.
  for (let i = 0; i < cfg.disputedLines; i++) {
    const lineRef = ref('d', i)
    const expected = applyFeeScheduleV1('payment_settlement', 40)!
    platform.push({ line_ref: lineRef, line_type: 'payment_settlement', channel: chan(i), client_id: client(i), call_count: 40, call_success: true })
    nebras.push({ line_ref: lineRef, line_type: 'payment_settlement', channel: chan(i), client_id: client(i), billed_fee: expected })
    openDisputeRefs.add(lineRef)
  }

  return { nebras, platform, fintech, openDisputeRefs }
}

/** Deterministic per-period synthetic sources. Same period → identical data. */
export function buildSimReconSources(period: string, config: SimReconConfig = {}): SimReconSources {
  const cfg = { ...DEFAULTS, ...config }
  const data = build(period, cfg)
  return {
    nebras: { fetch: async (_w: ReconWindow) => data.nebras },
    platform: { fetch: async (_w: ReconWindow) => data.platform },
    fintech: { fetch: async (_w: ReconWindow) => data.fintech },
    openDisputeRefs: data.openDisputeRefs
  }
}
