import { describe, expect, it } from 'vitest'
import { applyFeeScheduleV1 } from '../src/reconciliation/fee-schedule.js'
import { DEFAULT_THRESHOLDS, thresholdFor } from '../src/reconciliation/thresholds.js'
import { productFamily } from '../src/reconciliation/margin.js'
import { detectBreaks } from '../src/reconciliation/breaks.js'
import {
  runThreeWayReconciliation,
  type FintechBillingLine,
  type NebrasBillingLine,
  type PlatformLogLine,
  type ReconSources,
  type ReconWindow
} from '../src/reconciliation/engine.js'

/**
 * BACKOFFICE-68 — Dynamic Account Opening (dao_api_call) joins the three-way match
 * as a data-sharing line class: fee schedule at the data-sharing rate, data-sharing
 * fee-variance threshold as default, AISP product family.
 */

const WINDOW: ReconWindow = { start: '2026-07-14T00:00:00.000Z', end: '2026-07-15T00:00:00.000Z' }
const AED = 'AED'
const sourcesOf = (nebras: NebrasBillingLine[], platform: PlatformLogLine[], fintech: FintechBillingLine[] = []): ReconSources => ({
  nebras: { fetch: async () => nebras },
  platform: { fetch: async () => platform },
  fintech: { fetch: async () => fintech }
})

describe('BACKOFFICE-68 — DAO line class wiring', () => {
  it('prices dao_api_call at the data-sharing rate (25 milli-fils/line)', () => {
    expect(applyFeeScheduleV1('dao_api_call', 40)).toEqual({ amount: 1, currency: AED }) // 2.5 fils / 100 lines
    expect(applyFeeScheduleV1('dao_api_call', 400)).toEqual({ amount: 10, currency: AED })
  })

  it('uses the data-sharing fee-variance default threshold (1 fil, aed)', () => {
    expect(DEFAULT_THRESHOLDS.some((t) => t.fee_class === 'dao_api_call')).toBe(true)
    expect(thresholdFor('dao_api_call')).toEqual({ fee_class: 'dao_api_call', threshold_value: 1, unit: 'aed' })
  })

  it('maps dao_api_call to the AISP (data-sharing) product family', () => {
    expect(productFamily('dao_api_call')).toBe('AISP')
  })
})

describe('BACKOFFICE-68 — DAO in the three-way engine + break detection', () => {
  it('reconciles a tied DAO line as matched and flags a DAO fee variance as a break', async () => {
    const platform: PlatformLogLine[] = [
      { line_ref: 'dao-match', line_type: 'dao_api_call', channel: 'internal_retail', client_id: 'c1', call_count: 40, call_success: true },
      { line_ref: 'dao-var', line_type: 'dao_api_call', channel: 'internal_retail', client_id: 'c1', call_count: 40, call_success: true }
    ]
    const nebras: NebrasBillingLine[] = [
      { line_ref: 'dao-match', line_type: 'dao_api_call', channel: 'internal_retail', client_id: 'c1', billed_fee: { amount: 1, currency: AED } }, // ties (40 lines = 1 fil)
      { line_ref: 'dao-var', line_type: 'dao_api_call', channel: 'internal_retail', client_id: 'c1', billed_fee: { amount: 5, currency: AED } } // +4 fils variance
    ]

    const result = await runThreeWayReconciliation(sourcesOf(nebras, platform), WINDOW)
    const matched = result.lines.find((l) => l.line_ref === 'dao-match')!
    const varied = result.lines.find((l) => l.line_ref === 'dao-var')!
    expect(matched.line_type).toBe('dao_api_call')
    expect(matched.classification).toBe('matched')
    expect(varied.classification).toBe('unmatched')
    expect(varied.variance).toEqual({ amount: 4, currency: AED })

    const breaks = detectBreaks(result)
    const daoBreak = breaks.find((b) => b.line_type === 'dao_api_call')
    expect(daoBreak).toBeDefined()
    expect(daoBreak!.variance_amount).toEqual({ amount: 4, currency: AED })
    // the tied DAO line did not produce a break
    expect(breaks.filter((b) => b.line_type === 'dao_api_call')).toHaveLength(1)
  })
})
