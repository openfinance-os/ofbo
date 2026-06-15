import { describe, expect, it } from 'vitest'
import { applyFeeScheduleV1 } from '../src/reconciliation/fee-schedule.js'
import {
  runThreeWayReconciliation,
  type FintechBillingLine,
  type NebrasBillingLine,
  type PlatformLogLine,
  type ReconSources,
  type ReconWindow
} from '../src/reconciliation/engine.js'
import { buildSimReconSources } from '../src/reconciliation/sources.js'

/**
 * BACKOFFICE-01 — the three-way matching core + Commercial & Pricing Model v1.0
 * fee schedule. Matches technically-successful calls only; classifies
 * matched / unmatched / disputed.
 */

const WINDOW: ReconWindow = { start: '2026-07-14T00:00:00.000Z', end: '2026-07-15T00:00:00.000Z' }

const sourcesOf = (nebras: NebrasBillingLine[], platform: PlatformLogLine[], fintech: FintechBillingLine[] = []): ReconSources => ({
  nebras: { fetch: async () => nebras },
  platform: { fetch: async () => platform },
  fintech: { fetch: async () => fintech }
})

describe('fee schedule v1', () => {
  it('applies the per-line-type rates and aggregates to whole fils', () => {
    expect(applyFeeScheduleV1('payment_settlement', 40)).toEqual({ amount: 100, currency: 'AED' }) // 2.5 fils × 40
    expect(applyFeeScheduleV1('consent_record', 40)).toEqual({ amount: 20, currency: 'AED' }) // 0.5 fils × 40
    expect(applyFeeScheduleV1('lfi_access_log', 40)).toEqual({ amount: 1, currency: 'AED' }) // 2.5 fils / 100 lines
    expect(applyFeeScheduleV1('nebras_fees', 40)).toBeNull() // pass-through
  })

  it('throws on a call count that does not aggregate to whole fils (corrupt input)', () => {
    expect(() => applyFeeScheduleV1('lfi_access_log', 1)).toThrow(/whole fils/)
  })
})

describe('three-way reconciliation engine', () => {
  it('matches lines whose Nebras fee equals the schedule expectation', async () => {
    const lines = [
      { line_ref: 'L1', line_type: 'payment_settlement' as const, channel: 'internal_retail' },
      { line_ref: 'L2', line_type: 'consent_record' as const, channel: 'internal_retail' }
    ]
    const platform: PlatformLogLine[] = lines.map((l) => ({ ...l, call_count: 40, call_success: true }))
    const nebras: NebrasBillingLine[] = [
      { ...lines[0]!, billed_fee: { amount: 100, currency: 'AED' } },
      { ...lines[1]!, billed_fee: { amount: 20, currency: 'AED' } }
    ]
    const res = await runThreeWayReconciliation(sourcesOf(nebras, platform), WINDOW)
    expect(res.line_count_total).toBe(2)
    expect(res.line_count_matched).toBe(2)
    expect(res.line_count_unmatched).toBe(0)
  })

  it('flags a fee variance as unmatched with the signed variance amount', async () => {
    const platform: PlatformLogLine[] = [{ line_ref: 'V1', line_type: 'payment_settlement', channel: 'internal_retail', call_count: 40, call_success: true }]
    const nebras: NebrasBillingLine[] = [{ line_ref: 'V1', line_type: 'payment_settlement', channel: 'internal_retail', billed_fee: { amount: 107, currency: 'AED' } }]
    const res = await runThreeWayReconciliation(sourcesOf(nebras, platform), WINDOW)
    expect(res.line_count_unmatched).toBe(1)
    const line = res.lines[0]!
    expect(line.classification).toBe('unmatched')
    expect(line.reason).toBe('fee_variance')
    expect(line.variance).toEqual({ amount: 7, currency: 'AED' }) // billed 107 − expected 100
  })

  it('reconciles technically-successful calls only — failed calls are excluded from the universe', async () => {
    const platform: PlatformLogLine[] = [
      { line_ref: 'S1', line_type: 'payment_settlement', channel: 'internal_retail', call_count: 40, call_success: true },
      { line_ref: 'F1', line_type: 'payment_settlement', channel: 'internal_retail', call_count: 40, call_success: false }
    ]
    const nebras: NebrasBillingLine[] = [{ line_ref: 'S1', line_type: 'payment_settlement', channel: 'internal_retail', billed_fee: { amount: 100, currency: 'AED' } }]
    const res = await runThreeWayReconciliation(sourcesOf(nebras, platform), WINDOW)
    expect(res.line_count_total).toBe(1) // F1 excluded
    expect(res.lines.map((l) => l.line_ref)).toEqual(['S1'])
  })

  it('classifies missing-in-Nebras and open-dispute lines', async () => {
    const platform: PlatformLogLine[] = [
      { line_ref: 'M1', line_type: 'payment_settlement', channel: 'internal_retail', call_count: 40, call_success: true },
      { line_ref: 'D1', line_type: 'payment_settlement', channel: 'internal_retail', call_count: 40, call_success: true }
    ]
    const nebras: NebrasBillingLine[] = [{ line_ref: 'D1', line_type: 'payment_settlement', channel: 'internal_retail', billed_fee: { amount: 100, currency: 'AED' } }]
    const res = await runThreeWayReconciliation(sourcesOf(nebras, platform), WINDOW, { openDisputeRefs: new Set(['D1']) })
    expect(res.line_count_disputed).toBe(1)
    expect(res.line_count_unmatched).toBe(1) // M1 missing in Nebras
    expect(res.lines.find((l) => l.line_ref === 'M1')?.reason).toBe('missing_nebras_line')
    expect(res.lines.find((l) => l.line_ref === 'D1')?.classification).toBe('disputed')
  })

  it('requires fintech (source C) for a pass-through line to match', async () => {
    const platform: PlatformLogLine[] = [{ line_ref: 'P1', line_type: 'tpp_aas_pass_through', channel: 'internal_retail', call_count: 40, call_success: true }]
    const nebras: NebrasBillingLine[] = [{ line_ref: 'P1', line_type: 'tpp_aas_pass_through', channel: 'internal_retail', billed_fee: { amount: 1, currency: 'AED' } }]
    const withoutC = await runThreeWayReconciliation(sourcesOf(nebras, platform, []), WINDOW)
    expect(withoutC.lines[0]!.reason).toBe('missing_fintech_line')
    const withC = await runThreeWayReconciliation(sourcesOf(nebras, platform, [{ line_ref: 'P1', billed_fee: { amount: 1, currency: 'AED' } }]), WINDOW)
    expect(withC.line_count_matched).toBe(1)
  })

  it('the deterministic sim produces stable matched/unmatched/disputed counts', async () => {
    const bundle = buildSimReconSources('2026-07-15')
    const res = await runThreeWayReconciliation(bundle, WINDOW, { openDisputeRefs: bundle.openDisputeRefs })
    // defaults: 100 matched, 5 fee-variance + 3 missing = 8 unmatched, 2 disputed; 4 failed excluded
    expect(res.line_count_total).toBe(110)
    expect(res.line_count_matched).toBe(100)
    expect(res.line_count_unmatched).toBe(8)
    expect(res.line_count_disputed).toBe(2)
  })
})
