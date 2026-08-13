import { describe, expect, it } from 'vitest'
import {
  aed,
  buildProfitabilityReport,
  simulateFeeScenario,
  type ProfitabilityInput
} from '../src/index.js'

const input: ProfitabilityInput = {
  period: '2026-06',
  receivables: [
    { tppId: 'TPP-A', productFamily: 'payments', amountMilliFils: aed(120), sourceRefs: ['INV-A-PAY'] },
    { tppId: 'TPP-A', productFamily: 'data', amountMilliFils: aed(30), sourceRefs: ['INV-A-DATA'] },
    { tppId: 'TPP-B', productFamily: 'payments', amountMilliFils: aed(80), sourceRefs: ['INV-B-PAY'] }
  ],
  hubCosts: [
    { tppId: 'TPP-A', productFamily: 'payments', amountMilliFils: aed(10), sourceRefs: ['HUB-A'] },
    { tppId: 'TPP-B', productFamily: 'payments', amountMilliFils: aed(8), sourceRefs: ['HUB-B'] }
  ],
  liabilityProvisions: [
    { tppId: 'TPP-A', productFamily: 'payments', amountMilliFils: aed(5), sourceRefs: ['LIAB-A'] }
  ],
  tppAasMargins: [
    { tppId: 'TPP-A', productFamily: 'payments', amountMilliFils: aed(3), sourceRefs: ['MARGIN-A'] }
  ]
}

describe('BILL-09 profitability analytics', () => {
  it('reconciles per-TPP and product-family P&L to the invoice and payable inputs', () => {
    const report = buildProfitabilityReport(input)
    expect(report.totals).toEqual({
      receivableMilliFils: aed(230), hubCostMilliFils: aed(18), liabilityProvisionMilliFils: aed(5),
      tppAasMarginMilliFils: aed(3), profitMilliFils: aed(210)
    })
    expect(report.byTpp.find((row) => row.tppId === 'TPP-A')).toMatchObject({
      receivableMilliFils: aed(150), hubCostMilliFils: aed(10),
      liabilityProvisionMilliFils: aed(5), tppAasMarginMilliFils: aed(3), profitMilliFils: aed(138)
    })
    expect(report.byProductFamily.find((row) => row.productFamily === 'data')).toMatchObject({
      receivableMilliFils: aed(30), profitMilliFils: aed(30)
    })
    expect(report.reconciliation).toEqual({ balanced: true, deltaMilliFils: 0 })
  })

  it('runs deterministic, side-effect-free year-step, annual-review, and overage scenarios', () => {
    const before = structuredClone(input)
    const scenario = {
      scenarioId: 'annual-review-2027', effectiveDate: '2027-10-01',
      receivableMultiplierBasisPoints: 10_500,
      retailOverage: { overageUnits: 1_250, currentRateMilliFils: 0, proposedRateMilliFils: aed(0.095) }
    }
    expect(simulateFeeScenario(input, scenario)).toEqual(simulateFeeScenario(input, scenario))
    const result = simulateFeeScenario(input, scenario)
    expect(result.overage).toEqual({
      units: 1_250, silentDefaultRevenueMilliFils: 0,
      proposedRevenueMilliFils: aed(118.75), incrementalRevenueMilliFils: aed(118.75)
    })
    expect(result.projected.receivableMilliFils).toBe(aed(241.5) + aed(118.75))
    expect(input).toEqual(before)
  })

  it('rejects unsafe money, inconsistent periods, and malformed scenarios', () => {
    expect(() => buildProfitabilityReport({ ...input, period: '2026-6' })).toThrow(/period/)
    expect(() => buildProfitabilityReport({ ...input, receivables: [{ ...input.receivables[0]!, amountMilliFils: -1 }] })).toThrow(/non-negative/)
    expect(() => simulateFeeScenario(input, {
      scenarioId: '', effectiveDate: '2027-01-01', receivableMultiplierBasisPoints: 10_000,
      retailOverage: { overageUnits: 0, currentRateMilliFils: 0, proposedRateMilliFils: 0 }
    })).toThrow(/scenarioId/)
  })
})
