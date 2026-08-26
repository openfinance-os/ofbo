import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { aed, type RevenueAssuranceReport } from '../../billing/src/index.js'
import { applyMigrations, PgBillingRevenueAssuranceStore, PgLineageEmitter } from '../src/index.js'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('integration tests require DATABASE_URL')
const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }

describe('PgBillingRevenueAssuranceStore', () => {
  const lineage = new PgLineageEmitter(DATABASE_URL!, TENANCY)
  const store = new PgBillingRevenueAssuranceStore(DATABASE_URL!, TENANCY, lineage)
  beforeAll(async () => applyMigrations(DATABASE_URL!), 60_000)
  afterAll(async () => { await store.close(); await lineage.close() })

  it('persists immutable report/findings and append-only recovery under tenant RLS', async () => {
    const suffix = randomUUID()
    const recovery = { recoveryId: `REC-${suffix}`, period: '2026-06', findingCode: 'rate_drift' as const, amountMilliFils: aed(1), recoveredAt: '2026-08-10T00:00:00.000Z', sourceRef: `CN-${suffix}` }
    expect((await store.appendRecovery(recovery, suffix)).created).toBe(true)
    expect((await store.appendRecovery(recovery, suffix)).created).toBe(false)
    await expect(store.appendRecovery({ ...recovery, amountMilliFils: aed(2) }, suffix)).rejects.toThrow(/conflicting immutable/)
    expect(await store.recoveriesForPeriod('2026-06')).toEqual(expect.arrayContaining([recovery]))

    const report: RevenueAssuranceReport = {
      period: '2026-06', generatedAt: '2026-08-12T00:00:00.000Z', currency: 'AED', meteringCoveragePercent: 99,
      grossReceivableMilliFils: aed(100), leakageMilliFils: aed(2), leakageAed: 2, leakagePercent: 1.961,
      counterfactualOpportunityMilliFils: 0, counterfactualOpportunityAed: 0, recoverableMilliFils: aed(2),
      recoveredRevenueMilliFils: aed(1), recoveredRevenueAed: 1, outstandingRecoverableMilliFils: aed(1),
      findings: [{ code: 'rate_drift', title: 'Rate-card drift', amountMilliFils: aed(2), amountAed: 2, counterfactualMilliFils: 0, counterfactualAed: 0, recoverable: true, status: 'open', owner: 'Finance', sourceRefs: [`RATE-${suffix}`] }],
      varianceByFeeClass: [], recoveries: [recovery], disputeWindow: { raised: 0, missed: 0, targetMissed: 0 },
      target: { thresholdPercent: 1, comparison: 'strictly_below', met: false }, roiContribution: { feeVarianceRecoveredMilliFils: aed(1), feeVarianceRecoveredAed: 1 }
    }
    expect((await store.saveReport(report, suffix)).created).toBe(true)
    expect((await store.saveReport(report, suffix)).created).toBe(false)
    expect(await store.latestReport('2026-06')).toEqual(report)
    const otherTenant = new PgBillingRevenueAssuranceStore(DATABASE_URL!, { ...TENANCY, bankId: randomUUID() })
    expect(await otherTenant.latestReport('2026-06')).toBeNull()
    await otherTenant.close()
  }, 60_000)
})
