import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { FinanceViewService, FinanceViewError } from '../src/analytics/finance-view.js'
import { ScopeDeniedError } from '../src/rbac.js'
import type { Principal } from '../src/auth.js'
import type { FeeAccrual } from '@ofbo/db'
import { emptyMargin, type MarginSummary } from '../src/reconciliation/margin.js'
import { camelCaseKeys, FAPI_HEADERS } from './helpers.js'
import { aed, type RevenueAssuranceReport } from '@ofbo/billing'

/**
 * BACKOFFICE-31 — Finance View: MTD Nebras fee accrual (BACKOFFICE-32 aggregates),
 * TPP-aaS margin by fintech/family (BACKOFFICE-07), open Nebras dispute queue, and
 * the unbilled-traffic signal (BACKOFFICE-72) — reconciliation:read, with the
 * mandatory freshness envelope (BACKOFFICE-40).
 */

const PERIOD = '2026-05'
const finance: Principal = { subject: 'demo:finance-analyst', persona: 'finance-analyst', scopes: ['reconciliation:read', 'billing:read'] }
const care: Principal = { subject: 'demo:care', persona: 'customer-care-agent', scopes: ['consents:admin'] }

const accrual: FeeAccrual = {
  total_fee_minor: 550,
  currency: 'AED',
  by_line_type: [
    { line_type: 'lfi_access_log', total_fee_minor: 50, line_count: 1 },
    { line_type: 'payment_settlement', total_fee_minor: 500, line_count: 2 }
  ],
  source_published_at: '2026-05-28T00:00:00.000Z',
  stale: false
}

function svc(deps: Partial<ConstructorParameters<typeof FinanceViewService>[0]> = {}) {
  const margin: MarginSummary = { ...emptyMargin(), total_margin: 30, by_fintech: { 'org-1': { client_id: 'org-1', by_family: { SIP: { nebras_fee: 250, fintech_charge: 280, margin: 30 } }, total_margin: 30 } } }
  return new FinanceViewService({
    feeAccrual: { feeAccrualForPeriod: async () => accrual },
    margin: { marginForPeriod: async () => margin, threeWaySourceTotalsForPeriod: async () => ({ nebras: 5000, platform: 4900, fintech: 8400, currency: 'AED' }) },
    disputes: { openNebrasDisputeCount: async () => 3 },
    unbilled: { unbilledTrafficCount: async () => 2 },
    now: () => new Date('2026-05-15T12:00:00.000Z'),
    ...deps
  })
}

describe('FinanceViewService — composition', () => {
  it('rolls up fee accrual, margin, disputes, unbilled signal + fresh freshness', async () => {
    const { data, freshness } = await svc().view(finance, PERIOD)
    expect(data.mtd_nebras_fee_accrual).toEqual({ amount: 550, currency: 'AED' })
    expect((data.fee_accrual_by_line_type as unknown[]).length).toBe(2)
    expect((data.tpp_aas_margin as MarginSummary).total_margin).toBe(30)
    expect(data.open_nebras_dispute_count).toBe(3)
    expect(data.unbilled_traffic_alert_count).toBe(2)
    // UIF-07b — the three reconciliation SOURCE money totals (A Nebras / B platform metering / C fintech)
    expect(data.three_way_source_totals).toEqual({
      nebras_billing: { amount: 5000, currency: 'AED' },
      platform_metering: { amount: 4900, currency: 'AED' },
      fintech_rebill: { amount: 8400, currency: 'AED' }
    })
    expect(data.reconciliation_console_deeplink).toBe('/back-office/reconciliation/runs')
    expect(freshness.stale).toBe(false)
    expect(freshness.source_published_at).toBe('2026-05-28T00:00:00.000Z')
    expect(freshness.view_refreshed_at).toBe('2026-05-15T12:00:00.000Z')
  })

  it('UIF: emits typed sections the portal renders as bespoke panels (money in major units, no PSU PII)', async () => {
    const { data } = await svc().view(finance, PERIOD)
    const sections = data.sections as { kind: string; title: string; stats?: { label: string; value: string }[]; segments?: { label: string; value: number }[] }[]
    const byKind = (k: string) => sections.filter((s) => s.kind === k)

    const kpi = byKind('kpi-strip')[0]!
    expect(kpi.title).toBe('Finance Overview')
    expect(kpi.stats?.find((s) => s.label === 'MTD Nebras fee accrual')?.value).toBe('AED 5.50') // 550 minor → major
    expect(kpi.stats?.find((s) => s.label === 'TPP-aaS margin')?.value).toBe('AED 0.30')
    expect(kpi.stats?.find((s) => s.label === 'Open Nebras disputes')?.value).toBe('3')

    const bars = byKind('contribution-bars')
    expect(bars.map((b) => b.title)).toEqual(['Fee Accrual by Line Type', 'Margin by Product Family'])
    expect(bars[0]?.segments).toEqual([{ label: 'lfi_access_log', value: 50 }, { label: 'payment_settlement', value: 500 }])
    expect(bars[1]?.segments).toEqual([{ label: 'SIP', value: 30 }])

    expect(JSON.stringify(sections)).not.toMatch(/784|emirates|iban|psu_/i)
  })

  it('marks the view stale (amber) when the period has no ingested aggregates', async () => {
    const { data, freshness } = await svc({ feeAccrual: { feeAccrualForPeriod: async () => null } }).view(finance, PERIOD)
    expect(data.mtd_nebras_fee_accrual).toEqual({ amount: 0, currency: 'AED' })
    expect(freshness.stale).toBe(true)
    expect(freshness.stale_cause).toBe('no_ingested_aggregates_for_period')
  })

  it('propagates last-ingestion-failed staleness from the aggregates', async () => {
    const { freshness } = await svc({ feeAccrual: { feeAccrualForPeriod: async () => ({ ...accrual, stale: true }) } }).view(finance, PERIOD)
    expect(freshness.stale).toBe(true)
    expect(freshness.stale_cause).toBe('last_ingestion_failed')
  })

  it('surfaces BILL-05 collection exposure, dunning state, DSO, and net-settlement breaks', async () => {
    const { data } = await svc({
      collections: {
        collectionSummary: async () => ({
          openInvoiceCount: 2,
          openMilliFils: 1_250_000,
          settlementBreakCount: 1,
          settlementExpectedNetMilliFils: 2_000_000,
          settlementReceivedMilliFils: 1_999_000,
          settlementResidueMilliFils: -1_000,
          dunningByState: { overdue: 1, escalated: 1 },
          dsoByTpp: [{ tppId: 'TPP-1', dsoDays: 18, invoiceCount: 2, openInvoiceCount: 1, openMilliFils: 750_000 }]
        })
      }
    }).view(finance, PERIOD)

    expect(data.collections).toEqual(expect.objectContaining({
      open_invoice_count: 2,
      settlement_break_count: 1,
      dunning_by_state: { overdue: 1, escalated: 1 }
    }))
    // BACKOFFICE-87 — pin the collections half AT THE ENDPOINT, not only on the mapper.
    // `finance-view-wire.spec.ts` asserts `collectionsWire` in isolation and never constructs a
    // FinanceViewService, so on its own it cannot notice this endpoint dropping the shared mapper.
    // Without the two assertions below, reverting `collections: collectionsWire(collections)` to
    // the old hand-mapped block leaves the whole suite green — and `dso_by_tpp` is exactly where
    // the camelCase shipped (`tppId`, `dsoDays`, `openMilliFils`), which is why the fixture above
    // supplies a camelCase row.
    expect((data.collections as { dso_by_tpp: Record<string, unknown>[] }).dso_by_tpp[0]).toEqual({
      tpp_id: 'TPP-1', dso_days: 18, invoice_count: 2, open_invoice_count: 1, open_milli_fils: 750_000
    })
    expect(camelCaseKeys(data.collections), 'camelCase keys reached the wire').toEqual([])
    const sections = data.sections as { title: string; stats?: { label: string; value: string }[] }[]
    const collectionPanel = sections.find((section) => section.title === 'Collections & Net Settlement')
    expect(collectionPanel?.stats).toEqual(expect.arrayContaining([
      { label: 'Open direct invoices', value: '2' },
      { label: 'Open direct AR', value: 'AED 12.50' },
      { label: 'Settlement breaks', value: '1' }
    ]))
  })

  it('surfaces BILL-08 leakage, recovered revenue, dispute-window misses, and the VAL-01 ROI contribution', async () => {
    const assurance = {
      period: PERIOD, generatedAt: '2026-06-12T00:00:00.000Z', currency: 'AED', meteringCoveragePercent: 98,
      grossReceivableMilliFils: aed(100), leakageMilliFils: aed(2), leakageAed: 2, leakagePercent: 1.961,
      counterfactualOpportunityMilliFils: aed(9.5), counterfactualOpportunityAed: 9.5,
      recoverableMilliFils: aed(2), recoveredRevenueMilliFils: aed(1.25), recoveredRevenueAed: 1.25,
      outstandingRecoverableMilliFils: aed(0.75), findings: [{
        code: 'rate_drift', title: 'Rate-card drift', amountMilliFils: aed(2), amountAed: 2,
        counterfactualMilliFils: 0, counterfactualAed: 0, recoverable: true, status: 'open', owner: 'Finance', sourceRefs: ['RATE-1']
      }], varianceByFeeClass: [], recoveries: [], disputeWindow: { raised: 1, missed: 1, targetMissed: 0 },
      target: { thresholdPercent: 1, comparison: 'strictly_below', met: false },
      roiContribution: { feeVarianceRecoveredMilliFils: aed(1.25), feeVarianceRecoveredAed: 1.25 }
    } satisfies RevenueAssuranceReport
    const { data } = await svc({ assurance: { latestReport: async () => assurance } }).view(finance, PERIOD)

    expect(data.revenue_assurance).toEqual(expect.objectContaining({
      metering_coverage_percent: 98, leakage_milli_fils: aed(2), recovered_revenue_milli_fils: aed(1.25), missed_dispute_windows: 1
    }))
    expect(data.roi_narrative).toEqual({ fee_variance_recovered_milli_fils: aed(1.25), fee_variance_recovered_aed: 1.25 })
    const sections = data.sections as { title: string; stats?: { label: string; value: string }[] }[]
    expect(sections.find((section) => section.title === 'Revenue Assurance')?.stats).toEqual(expect.arrayContaining([
      { label: 'Metering coverage', value: '98.00%' },
      { label: 'Revenue leakage', value: 'AED 2.00' },
      { label: 'Recovered revenue', value: 'AED 1.25' }
    ]))
  })

  it('surfaces BILL-09 reconciled profitability by TPP and product family', async () => {
    const report = {
      period: PERIOD, currency: 'AED' as const,
      totals: { receivableMilliFils: aed(100), hubCostMilliFils: aed(10), lfiCostMilliFils: 0, liabilityProvisionMilliFils: aed(5), tppAasMarginMilliFils: aed(2), profitMilliFils: aed(87) },
      byTpp: [{ tppId: 'TPP-1', receivableMilliFils: aed(100), hubCostMilliFils: aed(10), lfiCostMilliFils: 0, liabilityProvisionMilliFils: aed(5), tppAasMarginMilliFils: aed(2), profitMilliFils: aed(87), sourceRefs: ['INV-1'], profitAed: 87 }],
      byProductFamily: [{ productFamily: 'payments' as const, receivableMilliFils: aed(100), hubCostMilliFils: aed(10), lfiCostMilliFils: 0, liabilityProvisionMilliFils: aed(5), tppAasMarginMilliFils: aed(2), profitMilliFils: aed(87), sourceRefs: ['INV-1'], profitAed: 87 }],
      reconciliation: { balanced: true, deltaMilliFils: 0 }
    }
    const { data } = await svc({ profitability: { latestReport: async () => report } }).view(finance, PERIOD)
    // BACKOFFICE-87 — re-pointed from the camelCase shape this assertion used to pin.
    // It asserted `totals: report.totals` and `reconciliation: { deltaMilliFils }`, i.e. the raw
    // TypeScript object spread straight onto the wire — so it codified the very drift it now
    // guards against: this endpoint shipped camelCase while /billing/console shipped snake_case
    // for the identical payload. The requirement (profitability totals and the reconciliation
    // verdict are surfaced) is unchanged; the shape is now the binding one.
    expect(data.tpp_profitability).toEqual(expect.objectContaining({
      totals: expect.objectContaining({ receivable_milli_fils: aed(100), profit_milli_fils: aed(87) }),
      reconciliation: { balanced: true, delta_milli_fils: 0 }
    }))
    expect(camelCaseKeys(data.tpp_profitability), 'camelCase keys reached the wire').toEqual([])
    const sections = data.sections as { title: string; stats?: { label: string; value: string }[] }[]
    expect(sections.find((section) => section.title === 'TPP Profitability')?.stats).toEqual(expect.arrayContaining([
      { label: 'Receivables', value: 'AED 100.00' },
      { label: 'Net contribution', value: 'AED 87.00' }
    ]))
  })

  it('defaults to the current month when no period is given', async () => {
    const { data } = await svc().view(finance)
    expect(data.period).toBe('2026-05')
  })

  it('rejects a malformed period (400)', async () => {
    await expect(svc().view(finance, '2026-5')).rejects.toBeInstanceOf(FinanceViewError)
  })

  it('rejects a principal without reconciliation:read (service-layer defence in depth)', async () => {
    await expect(svc().view(care, PERIOD)).rejects.toBeInstanceOf(ScopeDeniedError)
  })
})

describe('GET /back-office/analytics/finance-view (HTTP)', () => {
  const app = createApp()
  const auth = (persona: string) => ({ ...FAPI_HEADERS, authorization: `Bearer demo-token:${persona}` })

  it('returns 200 with the AnalyticsView envelope (data + freshness) for finance-analyst', async () => {
    const res = await app.request('/back-office/analytics/finance-view', { headers: auth('finance-analyst') })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Record<string, unknown>; meta: { request_id: string }; freshness: { stale: boolean } }
    expect(body.meta.request_id).toBeTruthy()
    expect(body.data.reconciliation_console_deeplink).toBe('/back-office/reconciliation/runs')
    expect(body.data).toHaveProperty('mtd_nebras_fee_accrual')
    expect(body.freshness).toHaveProperty('stale')
  })

  it('rejects a wrong-scope persona at the BFF middleware (403)', async () => {
    const res = await app.request('/back-office/analytics/finance-view', { headers: auth('customer-care-agent') })
    expect(res.status).toBe(403)
  })

  it('ignores an undeclared query parameter (always month-to-date — no contract drift)', async () => {
    // ?period is not a contract parameter; the view stays MTD and returns 200.
    const res = await app.request('/back-office/analytics/finance-view?period=nope', { headers: auth('finance-analyst') })
    expect(res.status).toBe(200)
  })
})
