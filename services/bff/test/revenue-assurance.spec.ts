import { describe, expect, it } from 'vitest'
import { aed, SCHEME_RATE_CARD_2026_06_02, type RevenueAssuranceInput } from '@ofbo/billing'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { InMemoryRevenueAssuranceStore, RevenueAssuranceService } from '../src/billing/revenue-assurance.js'

function input(): Omit<RevenueAssuranceInput, 'recoveries'> {
  return {
    period: '2026-06', generatedAt: '2026-08-12T00:00:00.000Z',
    metering: {
      lines: [], delivery: { received: 2, accepted: 2, duplicates: 0 },
      stats: { eventsTotal: 2, classified: 1, chargeableEvents: 1, freeEvents: 0, freeToLfiEvents: 0, excludedUnsuccessful: 0, unknownEndpoints: 1, inbound: 2, outbound: 0, coveragePercent: 50 },
      evidence: { pairing: [], freeTier: [], merchantAllowance: [], blindSpots: [{ eventId: 'blind-1', endpoint: 'GET /unknown', occurredAt: '2026-06-01T00:00:00.000Z', tppId: 'TPP-1' }] }
    },
    rating: { period: '2026-06', rateCardVersion: 'rc-1', yearStep: 1, priced: [], statements: [], tppAsService: [], batchAdjustments: [], freeToLfiEvents: 0, receivableTotalMilliFils: aed(100), payableHubTotalMilliFils: 0, payableLfiTotalMilliFils: 0, tppAsServiceRebillMilliFils: 0, tppAsServiceMarginMilliFils: 0 },
    memoDiffs: [], reratings: [], registeredTppIds: ['TPP-1'], blindSpotValuationMilliFils: aed(1),
    freeTierExceptions: [], overageOpportunity: { publishedRateMilliFils: 0, valuationRateMilliFils: aed(1), valuationRef: 'rate-decision-1' }
  }
}

describe('BILL-08 revenue-assurance orchestration', () => {
  it('appends recovered revenue, generates an immutable report, and emits High-class audit', async () => {
    const store = new InMemoryRevenueAssuranceStore()
    const audit = new InMemoryHighClassAuditSink()
    const service = new RevenueAssuranceService({ store, audit })
    await service.recordRecovery({ recoveryId: 'REC-1', period: '2026-06', findingCode: 'metering_blind_spot', amountMilliFils: aed(0.5), recoveredAt: '2026-08-10T00:00:00.000Z', sourceRef: 'CN-1' }, 'trace-recovery')
    const generated = await service.generate(input(), 'trace-report')
    expect(generated.created).toBe(true)
    expect(generated.report).toMatchObject({ recoveredRevenueAed: 0.5, leakageAed: 1, meteringCoveragePercent: 50 })
    expect(await service.latestReport('2026-06')).toEqual(generated.report)
    expect(audit.events.map((event) => event.event_type)).toEqual(['billing_revenue_recovered', 'billing_revenue_assurance_report_generated'])
  })

  it('is idempotent for identical recovery and report evidence and rejects conflicts', async () => {
    const store = new InMemoryRevenueAssuranceStore()
    const service = new RevenueAssuranceService({ store, audit: new InMemoryHighClassAuditSink() })
    const recovery = { recoveryId: 'REC-1', period: '2026-06', findingCode: 'metering_blind_spot' as const, amountMilliFils: aed(0.5), recoveredAt: '2026-08-10T00:00:00.000Z', sourceRef: 'CN-1' }
    expect((await service.recordRecovery(recovery, 'trace-1')).created).toBe(true)
    expect((await service.recordRecovery(recovery, 'trace-1')).created).toBe(false)
    await expect(service.recordRecovery({ ...recovery, amountMilliFils: aed(0.75) }, 'trace-2')).rejects.toThrow(/conflicting immutable/)
    expect((await service.generate(input(), 'trace-3')).created).toBe(true)
    expect((await service.generate(input(), 'trace-3')).created).toBe(false)
  })

  it('generates a period from the persisted-evidence seam used by the monthly worker', async () => {
    const evidence = input()
    const store = new InMemoryRevenueAssuranceStore()
    const service = new RevenueAssuranceService({
      store, audit: new InMemoryHighClassAuditSink(),
      evidence: { evidenceForPeriod: async () => ({
        metering: evidence.metering, memoDiffs: evidence.memoDiffs, reratings: evidence.reratings,
        registeredTppIds: evidence.registeredTppIds
      }) }
    })
    const rateCard = structuredClone(SCHEME_RATE_CARD_2026_06_02)
    const result = await service.generatePeriod({
      period: '2026-06', generatedAt: '2026-08-12T00:00:00.000Z', rateCard,
      blindSpotValuationMilliFils: aed(1), freeTierExceptions: [],
      overageOpportunity: { publishedRateMilliFils: rateCard.receivable['data.retail_page'].overageMilliFils, valuationRateMilliFils: rateCard.receivable['data.retail_page'].overageMilliFils, valuationRef: rateCard.receivable['data.retail_page'].overageSource }
    }, 'trace-period')
    expect(result.report.period).toBe('2026-06')
    expect(result.report.leakageAed).toBe(1)
  })
})
