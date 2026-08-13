import { describe, expect, it } from 'vitest'
import { aed, type FeeScenario, type ProfitabilityInput } from '@ofbo/billing'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { BillingProfitabilityService, InMemoryBillingProfitabilitySource } from '../src/billing/profitability.js'

const input: ProfitabilityInput = {
  period: '2026-06',
  receivables: [{ tppId: 'TPP-1', productFamily: 'payments', amountMilliFils: aed(100), sourceRefs: ['INV-1'] }],
  hubCosts: [{ tppId: 'TPP-1', productFamily: 'payments', amountMilliFils: aed(10), sourceRefs: ['HUB-1'] }],
  liabilityProvisions: [{ tppId: 'TPP-1', productFamily: 'payments', amountMilliFils: aed(5), sourceRefs: ['LIAB-1'] }],
  tppAasMargins: [{ tppId: 'TPP-1', productFamily: 'payments', amountMilliFils: aed(2), sourceRefs: ['MARGIN-1'] }]
}

const scenario: FeeScenario = {
  scenarioId: 'publish-overage', effectiveDate: '2026-09-01', receivableMultiplierBasisPoints: 10_000,
  retailOverage: { overageUnits: 100, currentRateMilliFils: 0, proposedRateMilliFils: aed(0.095) }
}

describe('BILL-09 profitability orchestration', () => {
  it('renders P&L, runs scenarios without persistence, and exports a regulator-ready pack', async () => {
    const source = new InMemoryBillingProfitabilitySource([input])
    const audit = new InMemoryHighClassAuditSink()
    const service = new BillingProfitabilityService({ source, audit, now: () => new Date('2026-08-13T00:00:00.000Z') })

    expect((await service.report('2026-06')).totals.profitMilliFils).toBe(aed(87))
    const projected = await service.simulate('2026-06', scenario)
    expect(projected.overage.incrementalRevenueMilliFils).toBe(aed(9.5))
    expect(source.writeCount).toBe(0)

    const exported = await service.cbuaeAnnualReviewExport('2026-06', [scenario], 'trace-export')
    expect(exported).toMatchObject({ schemaVersion: 'ofbo.cbuae-fee-review.v1', period: '2026-06', generatedAt: '2026-08-13T00:00:00.000Z' })
    expect(exported.sha256).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(audit.events.at(-1)?.event_type).toBe('billing_cbuae_fee_review_exported')
  })

  it('fails closed when period evidence is absent', async () => {
    const service = new BillingProfitabilityService({ source: new InMemoryBillingProfitabilitySource(), audit: new InMemoryHighClassAuditSink() })
    await expect(service.report('2026-06')).rejects.toThrow(/no profitability evidence/)
  })
})
