import { describe, expect, it } from 'vitest'
import {
  aed,
  buildExpectedCollectionMemo,
  buildRevenueAssuranceReport,
  diffCollectionMemo,
  meterBillableEvents,
  rateUsage,
  rerateClosedPeriod,
  SCHEME_RATE_CARD_2026_06_02
} from '@ofbo/billing'
import { billingMeteringFixture } from '@ofbo/synthetic-data'

describe('BILL-08 seeded simulator month', () => {
  it('renders every required injected leak class as an AED-valued finding', () => {
    const extraUnbilled = {
      specversion: '1.0', id: 'sim-unbilled-tpp', source: 'urn:ofbo:gateway:alpha-bank:simulator',
      type: 'com.ofbo.billing.gateway-call.v1', subject: 'TPP-SIM-UNBILLED', time: '2026-06-02T09:00:00Z',
      datacontenttype: 'application/json', fapiinteractionid: 'sim-trace-unbilled',
      data: { endpoint: 'POST /payments', outcome: 200, direction: 'inbound', tppId: 'TPP-SIM-UNBILLED', psuId: 'PSU-9999002', payment: { type: 'p2p_sme', amountMilliFils: aed(100) } }
    }
    const metering = meterBillableEvents([...billingMeteringFixture(), extraUnbilled], SCHEME_RATE_CARD_2026_06_02)
    const rating = rateUsage(metering.lines, SCHEME_RATE_CARD_2026_06_02, '2026-06')
    const expected = buildExpectedCollectionMemo(rating, '2026-07-03T12:00:00.000Z')
    const memo = {
      reference: 'SIM-MEMO-2026-06', period: '2026-06', issuedAt: '2026-07-05T00:00:00.000Z', receivedAt: '2026-07-06T00:00:00.000Z',
      lines: expected.lines.map((line, index) => ({ tppId: line.tppId, feeClass: line.feeClass, units: line.units, amountMilliFils: Math.max(0, line.amountMilliFils - (index === 0 ? aed(1) : 0)) }))
    }
    const memoDiff = diffCollectionMemo(expected, memo, 0)
    const correctedCard = structuredClone(SCHEME_RATE_CARD_2026_06_02)
    correctedCard.version = `${correctedCard.version}-corrected`
    correctedCard.receivable['payment.p2p_sme'].flatMilliFils += aed(0.01)
    const rerating = rerateClosedPeriod(metering.lines, SCHEME_RATE_CARD_2026_06_02, correctedCard, '2026-06', 'SIM-RATE-DRIFT', '2026-07-10T00:00:00.000Z')

    const report = buildRevenueAssuranceReport({
      period: '2026-06', generatedAt: '2026-07-12T00:00:00.000Z', metering, rating,
      memoDiffs: [memoDiff], reratings: [rerating], registeredTppIds: ['TPP-SIM-1'],
      blindSpotValuationMilliFils: aed(0.025),
      freeTierExceptions: [{ exceptionId: 'SIM-FREE-TIER-ABUSE', tppId: 'TPP-SIM-1', missedBillableUnits: 2, valuationRateMilliFils: aed(0.095), sourceRefs: ['sim-free-tier-counter'] }],
      overageOpportunity: { publishedRateMilliFils: null, valuationRateMilliFils: aed(0.095), valuationRef: 'SIM-DIRECTORY-RATE-DECISION' },
      recoveries: []
    })
    const amounts = Object.fromEntries(report.findings.map((finding) => [finding.code, finding.amountAed || finding.counterfactualAed]))
    expect(amounts).toEqual(expect.objectContaining({
      memo_under_collection: expect.any(Number), rate_drift: expect.any(Number), free_tier_abuse: 0.19,
      unbilled_traffic: 0.25, metering_blind_spot: 0.025, silent_overage: 0.19
    }))
    for (const code of ['memo_under_collection', 'rate_drift', 'free_tier_abuse', 'unbilled_traffic', 'metering_blind_spot', 'silent_overage']) {
      expect(amounts[code], code).toBeGreaterThan(0)
    }
  })
})
