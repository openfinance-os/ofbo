import { describe, expect, it } from 'vitest'
import {
  aed,
  buildRevenueAssuranceReport,
  type CollectionMemoDiff,
  type MeteringResult,
  type RatingResult,
  type RevenueAssuranceInput
} from '../src/index.js'

const period = '2026-06'

function input(): RevenueAssuranceInput {
  const metering: MeteringResult = {
    lines: [], delivery: { received: 100, accepted: 100, duplicates: 0 },
    stats: { eventsTotal: 100, classified: 98, chargeableEvents: 80, freeEvents: 10, freeToLfiEvents: 5, excludedUnsuccessful: 3, unknownEndpoints: 2, inbound: 90, outbound: 10, coveragePercent: 98 },
    evidence: { pairing: [], freeTier: [], merchantAllowance: [], blindSpots: [
      { eventId: 'blind-1', endpoint: 'GET /new-chargeable-resource', occurredAt: '2026-06-10T00:00:00.000Z', tppId: 'TPP-1' },
      { eventId: 'blind-2', endpoint: 'GET /new-chargeable-resource', occurredAt: '2026-06-11T00:00:00.000Z', tppId: 'TPP-1' }
    ] }
  }
  const rating: RatingResult = {
    period, rateCardVersion: 'rc-1', yearStep: 1,
    priced: [
      { eventId: 'rated-1', occurredAt: '2026-06-01T00:00:00.000Z', tppId: 'TPP-1', side: 'receivable', feeClass: 'payment.p2p_sme', units: 1, amountMilliFils: aed(100), rateDetail: null },
      { eventId: 'unbilled-1', occurredAt: '2026-06-02T00:00:00.000Z', tppId: 'TPP-MISSING', side: 'receivable', feeClass: 'payment.p2p_sme', units: 1, amountMilliFils: aed(20), rateDetail: null },
      { eventId: 'overage-1', occurredAt: '2026-06-03T00:00:00.000Z', tppId: 'TPP-1', side: 'receivable', feeClass: 'data.retail_page', units: 5, amountMilliFils: 0, rateDetail: null }
    ],
    statements: [], tppAsService: [], batchAdjustments: [], freeToLfiEvents: 0,
    receivableTotalMilliFils: aed(120), payableHubTotalMilliFils: 0, payableLfiTotalMilliFils: 0,
    tppAsServiceRebillMilliFils: 0, tppAsServiceMarginMilliFils: 0
  }
  const memoDiff: CollectionMemoDiff = {
    expectedPeriod: period, expectedRateCardVersion: 'rc-1', memoReference: 'MEMO-1', memoIssuedAt: '2026-07-05T00:00:00.000Z',
    memoReceivedAt: '2026-08-10T00:00:00.000Z', thresholdMilliFils: 0, queryDeadline: '2026-08-04T00:00:00.000Z',
    queryWindowStatus: 'expired', daysRemainingAtIngest: -6,
    lines: [{ lineRef: 'line-1', tppId: 'TPP-1', feeClass: 'payment.p2p_sme', expectedUnits: 1, memoUnits: 1,
      expectedMilliFils: aed(100), memoMilliFils: aed(90), varianceMilliFils: -aed(10), materialVariance: true,
      status: 'break', presence: 'both', eventIds: ['rated-1'], traceIds: ['trace-rated-1'] }],
    matchedLines: 0, materialBreaks: 1, expectedTotalMilliFils: aed(100), memoTotalMilliFils: aed(90),
    netVarianceMilliFils: -aed(10), grossVarianceMilliFils: aed(10)
  }
  return {
    period, generatedAt: '2026-08-12T00:00:00.000Z', metering, rating, memoDiffs: [memoDiff],
    reratings: [{
      period, correctionReference: 'RATE-DRIFT-1', reratedAt: '2026-08-01T00:00:00.000Z', previousRateCardVersion: 'rc-1',
      correctedRateCardVersion: 'rc-2', meteredFactsFingerprint: 'fnv1a32:00000001', factsUnchanged: true,
      previousTotalMilliFils: aed(120), correctedTotalMilliFils: aed(125), totalDeltaMilliFils: aed(5),
      lineDeltas: [{ lineRef: 'line-1', tppId: 'TPP-1', feeClass: 'payment.p2p_sme', previousMilliFils: aed(100), correctedMilliFils: aed(105), deltaMilliFils: aed(5) }],
      previous: { period, rateCardVersion: 'rc-1', generatedAt: '2026-07-03T00:00:00.000Z', dueAt: '2026-07-03T23:59:59.999Z', generatedOnTime: true, lines: [], totalMilliFils: aed(120) },
      corrected: { period, rateCardVersion: 'rc-2', generatedAt: '2026-08-01T00:00:00.000Z', dueAt: '2026-07-03T23:59:59.999Z', generatedOnTime: false, lines: [], totalMilliFils: aed(125) }
    }],
    registeredTppIds: ['TPP-1'], blindSpotValuationMilliFils: aed(1),
    freeTierExceptions: [{ exceptionId: 'FREE-ABUSE-1', tppId: 'TPP-1', missedBillableUnits: 3, valuationRateMilliFils: aed(2), sourceRefs: ['free-tier-counter-1'] }],
    overageOpportunity: { publishedRateMilliFils: null, valuationRateMilliFils: aed(9.5), valuationRef: 'directory-rate-decision-2026-01' },
    recoveries: [{ recoveryId: 'REC-1', period, findingCode: 'memo_under_collection', amountMilliFils: aed(12), recoveredAt: '2026-08-10T00:00:00.000Z', sourceRef: 'credit-note-1' }]
  }
}

describe('BILL-08 revenue assurance', () => {
  it('quantifies every seeded leakage class in AED and keeps opportunity loss separate', () => {
    const report = buildRevenueAssuranceReport(input())
    const byCode = Object.fromEntries(report.findings.map((finding) => [finding.code, finding]))
    expect(byCode.memo_under_collection?.amountAed).toBe(10)
    expect(byCode.rate_drift?.amountAed).toBe(5)
    expect(byCode.free_tier_abuse?.amountAed).toBe(6)
    expect(byCode.unbilled_traffic?.amountAed).toBe(20)
    expect(byCode.metering_blind_spot?.amountAed).toBe(2)
    expect(byCode.silent_overage?.counterfactualAed).toBe(47.5)
    expect(byCode.unsuccessful_calls?.amountAed).toBe(0)
    expect(report.leakageMilliFils).toBe(aed(43))
    expect(report.counterfactualOpportunityMilliFils).toBe(aed(47.5))
  })

  it('reports coverage, variance by fee class, missed windows, recoveries, and strict below-one-percent target', () => {
    const report = buildRevenueAssuranceReport(input())
    expect(report.meteringCoveragePercent).toBe(98)
    expect(report.varianceByFeeClass).toEqual([expect.objectContaining({ feeClass: 'payment.p2p_sme', expectedMilliFils: aed(100), memoMilliFils: aed(90), varianceMilliFils: -aed(10) })])
    expect(report.disputeWindow).toEqual({ raised: 1, missed: 1, targetMissed: 0 })
    expect(report.recoveredRevenueMilliFils).toBe(aed(12))
    expect(report.outstandingRecoverableMilliFils).toBe(aed(31))
    expect(report.leakagePercent).toBeCloseTo(26.38, 2)
    expect(report.target).toEqual({ thresholdPercent: 1, comparison: 'strictly_below', met: false })
    expect(report.roiContribution).toEqual({ feeVarianceRecoveredMilliFils: aed(12), feeVarianceRecoveredAed: 12 })
  })

  it('fails closed on inconsistent periods, duplicate recoveries, or over-recovery', () => {
    expect(() => buildRevenueAssuranceReport({ ...input(), rating: { ...input().rating, period: '2026-05' } })).toThrow(/rating period/)
    const duplicate = input()
    duplicate.recoveries.push({ ...duplicate.recoveries[0]! })
    expect(() => buildRevenueAssuranceReport(duplicate)).toThrow(/duplicate recovery/)
    const excess = input()
    excess.recoveries = [{ ...excess.recoveries[0]!, amountMilliFils: aed(44) }]
    expect(() => buildRevenueAssuranceReport(excess)).toThrow(/exceeds identified recoverable/)
  })
})
