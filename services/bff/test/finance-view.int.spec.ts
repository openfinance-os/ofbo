import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { applyMigrations, PgLineageEmitter, PgNebrasAggregateStore } from '@ofbo/db'
import { FinanceViewService } from '../src/analytics/finance-view.js'
import { emptyMargin } from '../src/reconciliation/margin.js'
import type { Principal } from '../src/auth.js'

/**
 * BACKOFFICE-31 integration: the Finance View's MTD fee accrual reads the real
 * BACKOFFICE-32 materialized aggregates under RLS, and freshness reflects the DB
 * state (fresh → stale after a failed ingest marks the period amber).
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const PERIOD = '2026-10'
const finance: Principal = { subject: 'demo:finance-analyst', persona: 'finance-analyst', scopes: ['reconciliation:read', 'billing:read'] }

describe('Finance View — fee accrual over real aggregates (RLS)', () => {
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const aggregates = new PgNebrasAggregateStore(url!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(url!)
  })
  afterAll(async () => {
    await aggregates.close()
    await lineage.close()
  })

  function service() {
    return new FinanceViewService({
      feeAccrual: aggregates,
      margin: { marginForPeriod: async () => emptyMargin(), threeWaySourceTotalsForPeriod: async () => ({ nebras: 0, platform: 0, fintech: 0, currency: 'AED' }) },
      disputes: { openNebrasDisputeCount: async () => 0 },
      unbilled: { unbilledTrafficCount: async () => 0 }
    })
  }

  it('rolls up the period aggregates and reflects fresh→stale freshness', async () => {
    await aggregates.refresh(
      [
        { period: PERIOD, channel: 'internal_retail', line_type: 'payment_settlement', total_fee_minor: 500, line_count: 2, currency: 'AED', source_published_at: `${PERIOD}-28T00:00:00.000Z` },
        { period: PERIOD, channel: 'internal_retail', line_type: 'lfi_access_log', total_fee_minor: 50, line_count: 1, currency: 'AED', source_published_at: `${PERIOD}-28T00:00:00.000Z` }
      ],
      randomUUID()
    )

    const fresh = await service().view(finance, PERIOD)
    expect(fresh.data.mtd_nebras_fee_accrual).toEqual({ amount: 550, currency: 'AED' })
    expect((fresh.data.fee_accrual_by_line_type as unknown[]).length).toBe(2)
    expect(fresh.freshness.stale).toBe(false)
    expect(fresh.freshness.source_published_at).toBe(`${PERIOD}-28T00:00:00.000Z`)

    // a failed ingest marks the period stale → the view goes amber, accrual retained
    await aggregates.markStale(PERIOD, randomUUID())
    const stale = await service().view(finance, PERIOD)
    expect(stale.data.mtd_nebras_fee_accrual).toEqual({ amount: 550, currency: 'AED' })
    expect(stale.freshness.stale).toBe(true)
    expect(stale.freshness.stale_cause).toBe('last_ingestion_failed')
  })
})
