import { describe, expect, it } from 'vitest'
import {
  SCHEME_RATE_CARD_2026_06_02,
  aed,
  METERING_PROJECTION_VERSION,
  buildProfitabilityReport,
  fils,
  meterBillableEvents,
  meteringInputPreimage,
  type BillingCloudEvent,
  type BillingGatewayCall,
  type RateCard,
  type ProfitabilityInput
} from '../src/index.js'

/**
 * BILL-12 — the two confirmed defects in the payable projection (ADR 0007, review findings M2/M-defects).
 *
 * 1. Outbound (payable) corporate data was metered as retail overage under the RETAIL free tier.
 *    The scheme prices corporate data at 40 fils/page with NO free tier, and the inbound path already
 *    branches on segment — the outbound path must too.
 * 2. Profitability treated ONLY Hub payables as external cost, so the underlying-LFI cost the
 *    institution genuinely owes was invisible in the P&L.
 */

function event(id: string, data: Partial<BillingGatewayCall> & Pick<BillingGatewayCall, 'endpoint'>, time = '2026-06-15T10:00:00Z'): BillingCloudEvent {
  return {
    specversion: '1.0',
    id,
    source: 'urn:ofbo:gateway',
    type: 'com.ofbo.billing.gateway-call.v1',
    subject: id,
    time,
    datacontenttype: 'application/json',
    fapiinteractionid: `fapi-${id}`,
    data: {
      outcome: 200,
      direction: 'outbound',
      tppId: 'bank-as-tpp',
      psuId: 'psu-1',
      counterpartyLfiId: 'lfi-alpha',
      ...data
    } as BillingGatewayCall
  }
}

const corporateCall = (id: string, lines: number, time?: string) =>
  event(id, {
    endpoint: 'GET /accounts/{id}/transactions',
    data: { segment: 'corporate', attended: true, lines }
  }, time)

const retailCall = (id: string, lines: number, lfiId: string, time?: string) =>
  event(id, {
    endpoint: 'GET /accounts/{id}/transactions',
    counterpartyLfiId: lfiId,
    data: { segment: 'retail', attended: true, lines }
  }, time)

describe('outbound corporate data metering', () => {
  it('bills every corporate page at the corporate rate with no free allowance', () => {
    // 250 lines = 3 pages. Corporate has NO free tier, so all 3 are billable.
    const result = meterBillableEvents([corporateCall('evt-corp', 250)], SCHEME_RATE_CARD_2026_06_02)
    const payable = result.lines.find((line) => line.side === 'payable_lfi')

    expect(payable).toMatchObject({ feeClass: 'data.corporate_page', units: 3 })
    expect(payable?.freeUnits).toBeUndefined()
  })

  it('does not spend a retail free-tier allowance on corporate traffic', () => {
    const result = meterBillableEvents(
      [corporateCall('evt-corp', 1_000), retailCall('evt-retail', 200, 'lfi-alpha', '2026-06-15T11:00:00Z')],
      SCHEME_RATE_CARD_2026_06_02
    )

    const corporate = result.lines.find((line) => line.eventId === 'evt-corp' && line.side === 'payable_lfi')
    const retail = result.lines.find((line) => line.eventId === 'evt-retail' && line.side === 'payable_lfi')

    expect(corporate).toMatchObject({ feeClass: 'data.corporate_page', units: 10 })
    // The retail call still gets its full 15-page attended allowance: 2 pages, all free.
    expect(retail).toMatchObject({ feeClass: 'data.retail_page', units: 0, freeUnits: 2 })
  })

  it('pools one retail allowance per customer per day by default, which cannot understate the payable', () => {
    // The scheme says "15 pages/customer/day" without stating whether each serving LFI grants its
    // own allowance. The default is the reading that charges MORE, so an unconfirmed assumption can
    // never make the bank's projected cost look smaller than it is.
    const result = meterBillableEvents(
      [
        retailCall('evt-alpha', 1_600, 'lfi-alpha'),
        retailCall('evt-beta', 200, 'lfi-beta', '2026-06-15T10:05:00Z')
      ],
      SCHEME_RATE_CARD_2026_06_02
    )

    expect(SCHEME_RATE_CARD_2026_06_02.receivable['data.retail_page'].freeTier.per).toBe('psu_per_day')
    // 16 pages exhaust the single 15-page allowance, so lfi-beta's 2 pages are all billable.
    expect(result.lines.find((line) => line.eventId === 'evt-alpha' && line.side === 'payable_lfi'))
      .toMatchObject({ units: 1, freeUnits: 15 })
    expect(result.lines.find((line) => line.eventId === 'evt-beta' && line.side === 'payable_lfi'))
      .toMatchObject({ units: 2, freeUnits: 0 })
  })

  it('gives each serving LFI its own allowance only when the rate card says so', () => {
    const perLfiCard = structuredClone(SCHEME_RATE_CARD_2026_06_02) as RateCard
    perLfiCard.receivable['data.retail_page'].freeTier.per = 'psu_per_serving_lfi_per_day'

    const result = meterBillableEvents(
      [
        retailCall('evt-alpha', 1_600, 'lfi-alpha'),
        retailCall('evt-beta', 200, 'lfi-beta', '2026-06-15T10:05:00Z')
      ],
      perLfiCard
    )

    expect(result.lines.find((line) => line.eventId === 'evt-alpha' && line.side === 'payable_lfi'))
      .toMatchObject({ units: 1, freeUnits: 15 })
    // lfi-beta's own allowance is untouched by lfi-alpha's consumption.
    expect(result.lines.find((line) => line.eventId === 'evt-beta' && line.side === 'payable_lfi'))
      .toMatchObject({ units: 0, freeUnits: 2 })
  })

  it('keeps the inbound allowance PSU-scoped, since the bank is the only LFI serving its own data', () => {
    const result = meterBillableEvents(
      [event('evt-in', {
        endpoint: 'GET /accounts/{id}/transactions',
        direction: 'inbound',
        data: { segment: 'retail', attended: true, lines: 1_600 }
      })],
      SCHEME_RATE_CARD_2026_06_02
    )

    expect(result.lines.find((line) => line.side === 'receivable')).toMatchObject({ units: 1, freeUnits: 15 })
  })

  it('still exhausts a single serving LFI allowance across that LFI calls in one day', () => {
    const result = meterBillableEvents(
      [
        retailCall('evt-1', 1_000, 'lfi-alpha'),
        retailCall('evt-2', 1_000, 'lfi-alpha', '2026-06-15T12:00:00Z')
      ],
      SCHEME_RATE_CARD_2026_06_02
    )

    const first = result.lines.find((line) => line.eventId === 'evt-1' && line.side === 'payable_lfi')
    const second = result.lines.find((line) => line.eventId === 'evt-2' && line.side === 'payable_lfi')

    expect(first).toMatchObject({ units: 0, freeUnits: 10 })
    // Only 5 of the second call's 10 pages remain free.
    expect(second).toMatchObject({ units: 5, freeUnits: 5 })
  })
})

describe('metering projection version', () => {
  it('binds the projection version into the meter-run input pre-image', () => {
    // Without this, a corrected projection produces different lines from byte-identical events,
    // collides with the stale run on (period, rate_card_version, input_hash), and is never written.
    const events = ['{"id":"b"}', '{"id":"a"}']

    expect(meteringInputPreimage(events, '2026-08-17')).toBe('metering-projection:2026-08-17\n{"id":"a"}\n{"id":"b"}')
    expect(meteringInputPreimage(events, '2026-08-17')).not.toBe(meteringInputPreimage(events, '2026-09-01'))
  })

  it('is order-independent over the period events and refuses an empty version', () => {
    expect(meteringInputPreimage(['{"id":"a"}', '{"id":"b"}'])).toBe(meteringInputPreimage(['{"id":"b"}', '{"id":"a"}']))
    expect(METERING_PROJECTION_VERSION.trim()).not.toBe('')
    expect(() => meteringInputPreimage(['{"id":"a"}'], ' ')).toThrow(/projectionVersion/)
  })
})

describe('profitability with underlying-LFI cost', () => {
  const input: ProfitabilityInput = {
    period: '2026-06',
    receivables: [{ tppId: 'tpp-a', productFamily: 'payments', amountMilliFils: aed(230), sourceRefs: ['inv-1'] }],
    hubCosts: [{ tppId: 'tpp-a', productFamily: 'tpp_aas', amountMilliFils: aed(18), sourceRefs: ['meter-1'] }],
    lfiCosts: [{ tppId: 'tpp-a', productFamily: 'tpp_aas', amountMilliFils: aed(40), sourceRefs: ['meter-2'] }],
    liabilityProvisions: [{ tppId: 'tpp-a', productFamily: 'payments', amountMilliFils: aed(5), sourceRefs: ['prov-1'] }],
    tppAasMargins: [{ tppId: 'tpp-a', productFamily: 'tpp_aas', amountMilliFils: aed(12), sourceRefs: ['margin-1'] }]
  }

  it('reports underlying-LFI cost as its own external-cost dimension', () => {
    const report = buildProfitabilityReport(input)

    expect(report.totals).toMatchObject({
      receivableMilliFils: aed(230),
      hubCostMilliFils: aed(18),
      lfiCostMilliFils: aed(40)
    })
  })

  it('subtracts underlying-LFI cost from profit — the defect this story closes', () => {
    const report = buildProfitabilityReport(input)

    // 230 - 18 - 40 - 5 + 12
    expect(report.totals.profitMilliFils).toBe(aed(179))
    // Ignoring the LFI cost would have overstated profit by exactly that cost.
    const withoutLfi = buildProfitabilityReport({ ...input, lfiCosts: [] })
    expect(withoutLfi.totals.profitMilliFils - report.totals.profitMilliFils).toBe(aed(40))
  })

  it('carries LFI cost through the per-TPP and per-product-family breakdowns and still balances', () => {
    const report = buildProfitabilityReport(input)

    expect(report.byTpp.find((row) => row.tppId === 'tpp-a')?.lfiCostMilliFils).toBe(aed(40))
    expect(report.byProductFamily.find((row) => row.productFamily === 'tpp_aas')?.lfiCostMilliFils).toBe(aed(40))
    expect(report.reconciliation).toMatchObject({ balanced: true, deltaMilliFils: 0 })
  })

  it('validates LFI cost lines exactly like every other evidence line', () => {
    expect(() => buildProfitabilityReport({
      ...input,
      lfiCosts: [{ tppId: 'tpp-a', productFamily: 'tpp_aas', amountMilliFils: -1, sourceRefs: ['meter-2'] }]
    })).toThrow(/non-negative/)
    expect(() => buildProfitabilityReport({
      ...input,
      lfiCosts: [{ tppId: 'tpp-a', productFamily: 'tpp_aas', amountMilliFils: fils(1), sourceRefs: [] }]
    })).toThrow(/evidence references/)
  })
})
