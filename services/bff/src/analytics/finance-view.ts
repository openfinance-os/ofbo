import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { FeeAccrual } from '@ofbo/db'
import type { MarginSummary } from '../reconciliation/margin.js'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import { collectionsWire, profitabilityReportWire } from '../billing/wire.js'
import { scopeDenied } from '../errors.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import { computeFreshness, FRESHNESS_CADENCE, type FreshnessEnvelope } from './freshness.js'
import type { CollectionsFinanceSummary } from '../billing/collections.js'
import type { ProfitabilityReport, RevenueAssuranceReport } from '@ofbo/billing'

/**
 * BACKOFFICE-31 — Finance View. A read-only analytics view (reconciliation:read,
 * enforced at the BFF middleware AND re-checked here) that composes already-persisted
 * data: MTD Nebras fee accrual (the BACKOFFICE-32 materialized aggregates), TPP-aaS
 * margin by fintech + product family (BACKOFFICE-07, re-derived per period), the open
 * Nebras dispute queue, and the unbilled-traffic signal (BACKOFFICE-72) — all under
 * the Finance View's single scope, with the mandatory freshness envelope (BACKOFFICE-40).
 * No new data, no mutation, no PSU PII.
 */

export const FINANCE_VIEW_SCOPE = 'reconciliation:read'
const RECON_CONSOLE_DEEPLINK = '/back-office/reconciliation/runs'

export interface FinanceFeeAccrualReader {
  feeAccrualForPeriod(period: string): Promise<FeeAccrual | null>
}
export interface FinanceMarginReader {
  marginForPeriod(principal: Principal, period: string): Promise<MarginSummary>
  /** UIF-07b — the three reconciliation sources' money totals (A Nebras / B platform metering / C fintech). */
  threeWaySourceTotalsForPeriod(period: string): Promise<{ nebras: number; platform: number; fintech: number; currency: string }>
}
export interface FinanceDisputeReader {
  openNebrasDisputeCount(principal: Principal, period: string): Promise<number>
}
export interface FinanceUnbilledReader {
  unbilledTrafficCount(): Promise<number>
}
export interface FinanceCollectionsReader {
  collectionSummary(period: string, asOf: string): Promise<CollectionsFinanceSummary>
}
export interface FinanceRevenueAssuranceReader {
  latestReport(period: string): Promise<RevenueAssuranceReport | null>
}
export interface FinanceProfitabilityReader {
  latestReport(period: string): Promise<ProfitabilityReport | null>
}

export interface FinanceViewDeps {
  feeAccrual: FinanceFeeAccrualReader
  margin: FinanceMarginReader
  disputes: FinanceDisputeReader
  unbilled: FinanceUnbilledReader
  collections?: FinanceCollectionsReader
  assurance?: FinanceRevenueAssuranceReader
  profitability?: FinanceProfitabilityReader
  now?: () => Date
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

export class FinanceViewError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export class FinanceViewService {
  constructor(private readonly deps: FinanceViewDeps) {}

  async view(principal: Principal, period?: string): Promise<{ data: Record<string, unknown>; freshness: FreshnessEnvelope }> {
    assertScope(principal, FINANCE_VIEW_SCOPE)
    const p = period ?? (this.deps.now ?? (() => new Date()))().toISOString().slice(0, 7)
    if (!MONTH.test(p)) throw new FinanceViewError('BACKOFFICE.INVALID_PERIOD', 'period must be a calendar month YYYY-MM.', 400)

    const now = (this.deps.now ?? (() => new Date()))()
    const [accrual, margin, openDisputes, unbilled, sourceTotals, collections, assurance, profitability] = await Promise.all([
      this.deps.feeAccrual.feeAccrualForPeriod(p),
      this.deps.margin.marginForPeriod(principal, p),
      this.deps.disputes.openNebrasDisputeCount(principal, p),
      this.deps.unbilled.unbilledTrafficCount(),
      this.deps.margin.threeWaySourceTotalsForPeriod(p),
      this.deps.collections?.collectionSummary(p, now.toISOString().slice(0, 10)) ?? Promise.resolve({
        openInvoiceCount: 0,
        openMilliFils: 0,
        settlementBreakCount: 0,
        settlementExpectedNetMilliFils: 0,
        settlementReceivedMilliFils: 0,
        settlementResidueMilliFils: 0,
        dunningByState: {},
        dsoByTpp: []
      }),
      this.deps.assurance?.latestReport(p) ?? Promise.resolve(null),
      this.deps.profitability?.latestReport(p) ?? Promise.resolve(null)
    ])

    // UIF (ADR 0016 D1) — typed sections the portal renders as bespoke panels (same shared
    // renderer as Analytics/Risk/Operations); money shown in major units, no PSU PII.
    const cur = accrual?.currency ?? margin.currency ?? 'AED'
    const fmtMoney = (minor: number) => `${cur} ${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    const fmtMilliFils = (milliFils: number) => fmtMoney(Math.round(milliFils / 1_000))
    const marginByFamily: Record<string, number> = {}
    for (const fm of Object.values(margin.by_fintech)) {
      for (const [family, acc] of Object.entries(fm.by_family)) marginByFamily[family] = (marginByFamily[family] ?? 0) + acc.margin
    }
    const feeSegments = (accrual?.by_line_type ?? [])
      .map((l) => ({ label: l.line_type, value: l.total_fee_minor }))
      .filter((s) => s.value > 0)
    const familySegments = Object.entries(marginByFamily)
      .map(([label, value]) => ({ label, value }))
      .filter((s) => s.value > 0)
    const sections: Record<string, unknown>[] = [
      {
        kind: 'kpi-strip',
        title: 'Finance Overview',
        stats: [
          { label: 'MTD Nebras fee accrual', value: fmtMoney(accrual?.total_fee_minor ?? 0) },
          { label: 'TPP-aaS margin', value: fmtMoney(margin.total_margin) },
          { label: 'Open Nebras disputes', value: String(openDisputes) },
          { label: 'Unbilled-traffic alerts', value: String(unbilled) }
        ]
      }
    ]
    if (feeSegments.length > 0) sections.push({ kind: 'contribution-bars', title: 'Fee Accrual by Line Type', segments: feeSegments })
    if (familySegments.length > 0) sections.push({ kind: 'contribution-bars', title: 'Margin by Product Family', segments: familySegments })
    // UIF-07b — the three reconciliation sources at the money level (A Nebras / B platform / C fintech).
    sections.push({
      kind: 'kpi-strip',
      title: 'Three-Way Source Reconciliation',
      stats: [
        { label: 'A · Nebras billing', value: fmtMoney(sourceTotals.nebras) },
        { label: 'B · Bank metering', value: fmtMoney(sourceTotals.platform) },
        { label: 'C · Fintech re-bill', value: fmtMoney(sourceTotals.fintech) }
      ]
    })
    sections.push({
      kind: 'kpi-strip',
      title: 'Collections & Net Settlement',
      stats: [
        { label: 'Open direct invoices', value: String(collections.openInvoiceCount) },
        { label: 'Open direct AR', value: fmtMilliFils(collections.openMilliFils) },
        { label: 'Settlement breaks', value: String(collections.settlementBreakCount) },
        { label: 'Net settlement received', value: fmtMilliFils(collections.settlementReceivedMilliFils) }
      ]
    })
    const dunningSegments = Object.entries(collections.dunningByState).map(([label, value]) => ({ label, value }))
    if (dunningSegments.length > 0) sections.push({ kind: 'contribution-bars', title: 'Dunning by State', segments: dunningSegments })
    if (collections.dsoByTpp.length > 0) sections.push({
      kind: 'contribution-bars',
      title: 'DSO by TPP',
      segments: collections.dsoByTpp.map((summary) => ({ label: summary.tppId, value: summary.dsoDays }))
    })
    if (assurance) sections.push({
      kind: 'kpi-strip',
      title: 'Revenue Assurance',
      stats: [
        { label: 'Metering coverage', value: `${assurance.meteringCoveragePercent.toFixed(2)}%` },
        { label: 'Revenue leakage', value: fmtMilliFils(assurance.leakageMilliFils) },
        { label: 'Recovered revenue', value: fmtMilliFils(assurance.recoveredRevenueMilliFils) },
        { label: 'Missed dispute windows', value: String(assurance.disputeWindow.missed) }
      ]
    })
    if (profitability) sections.push({
      kind: 'kpi-strip',
      title: 'TPP Profitability',
      stats: [
        { label: 'Receivables', value: fmtMilliFils(profitability.totals.receivableMilliFils) },
        { label: 'Hub costs', value: fmtMilliFils(profitability.totals.hubCostMilliFils) },
        // BILL-12: the underlying-LFI cost stands beside the Hub cost rather than being folded into it.
        { label: 'Underlying-LFI costs', value: fmtMilliFils(profitability.totals.lfiCostMilliFils) },
        { label: 'Liability provisions', value: fmtMilliFils(profitability.totals.liabilityProvisionMilliFils) },
        { label: 'Net contribution', value: fmtMilliFils(profitability.totals.profitMilliFils) }
      ]
    })

    const data = {
      sections,
      period: p,
      mtd_nebras_fee_accrual: { amount: accrual?.total_fee_minor ?? 0, currency: accrual?.currency ?? 'AED' },
      three_way_source_totals: {
        nebras_billing: { amount: sourceTotals.nebras, currency: sourceTotals.currency },
        platform_metering: { amount: sourceTotals.platform, currency: sourceTotals.currency },
        fintech_rebill: { amount: sourceTotals.fintech, currency: sourceTotals.currency }
      },
      fee_accrual_by_line_type: (accrual?.by_line_type ?? []).map((l) => ({ line_type: l.line_type, amount: { amount: l.total_fee_minor, currency: accrual!.currency }, line_count: l.line_count })),
      tpp_aas_margin: margin,
      open_nebras_dispute_count: openDisputes,
      unbilled_traffic_alert_count: unbilled,
      // The SHARED mapper, not a second copy. This block used to hand-map most fields and then
      // spread `collections.dsoByTpp` raw, so the nested rows shipped `tppId` / `dsoDays` /
      // `openMilliFils` — camelCase on the wire, while GET /back-office/billing/console emitted the
      // identical payload correctly through wire.ts. `AnalyticsView.data` is
      // `additionalProperties: true`, so no schema caught it; only the convention forbade it, and a
      // convention with nothing asserting it is a preference. One shape, one place to change it.
      //
      // TWO of the three sibling blocks, to be exact — `collections` and `tpp_profitability` now go
      // through the shared mappers, `revenue_assurance` below does not. That is deliberate and
      // recorded here because the sentence above would otherwise imply it was swept too.
      collections: collectionsWire(collections),
      // DELIBERATELY a narrower projection than `assuranceWire`, not an oversight.
      //
      // `GET /back-office/billing/console` emits the same source object through `assuranceWire`
      // with period, currency, generated_at, variance_by_fee_class, recoveries, dispute_window,
      // target, roi_contribution and richer findings[] rows — that is the operator's working
      // surface for revenue assurance. This is the finance SUMMARY view, where the block is one
      // panel among eight, so it carries the headline figures and the target verdict only.
      //
      // The cost is real and worth naming: `target_percent`, `target_met` and
      // `missed_dispute_windows` are flattenings that exist nowhere else, so a field added to
      // `RevenueAssuranceReport` reaches one endpoint and not the other. If that cost outgrows the
      // benefit, the fix is to project FROM `assuranceWire` rather than beside it — a response-shape
      // change with its own story, not a quiet edit here.
      revenue_assurance: assurance ? {
        metering_coverage_percent: assurance.meteringCoveragePercent,
        leakage_milli_fils: assurance.leakageMilliFils,
        leakage_percent: assurance.leakagePercent,
        target_percent: assurance.target.thresholdPercent,
        target_met: assurance.target.met,
        recovered_revenue_milli_fils: assurance.recoveredRevenueMilliFils,
        outstanding_recoverable_milli_fils: assurance.outstandingRecoverableMilliFils,
        counterfactual_opportunity_milli_fils: assurance.counterfactualOpportunityMilliFils,
        missed_dispute_windows: assurance.disputeWindow.missed,
        findings: assurance.findings.map((finding) => ({
          code: finding.code, amount_milli_fils: finding.amountMilliFils,
          counterfactual_milli_fils: finding.counterfactualMilliFils, status: finding.status, owner: finding.owner
        }))
      } : null,
      // Same reason: `totals`, `byTpp` and `byProductFamily` were spread straight from the
      // TypeScript shape, so `by_product_family` arrived as `byProductFamily`.
      //
      // Not purely a casing fix, though: the shared mapper also emits `period` and `currency` at
      // report level, which the hand-mapped block did not. That is an ADDITIVE widening of the
      // response — legal, since `AnalyticsView.data` is `additionalProperties: true`, and an
      // improvement on the money posture (this block now says which currency its amounts are in;
      // `collections` still does not). Recorded here rather than left for a reader to discover,
      // because "casing only" would understate what changed on the wire.
      tpp_profitability: profitability ? profitabilityReportWire(profitability) : null,
      roi_narrative: {
        fee_variance_recovered_milli_fils: assurance?.roiContribution.feeVarianceRecoveredMilliFils ?? 0,
        fee_variance_recovered_aed: assurance?.roiContribution.feeVarianceRecoveredAed ?? 0
      },
      reconciliation_console_deeplink: RECON_CONSOLE_DEEPLINK
    }
    // BACKOFFICE-40 — standard freshness: a failed ingestion (accrual.stale) wins,
    // else amber when the source roll-up is older than 2× the monthly publish cadence.
    const freshness = computeFreshness({
      sourcePublishedAt: accrual?.source_published_at ?? null,
      now,
      sourceCadenceMs: FRESHNESS_CADENCE.MONTHLY_MS,
      missingCause: 'no_ingested_aggregates_for_period',
      extraStale: accrual?.stale ? { stale: true, cause: 'last_ingestion_failed' } : null
    })
    return { data, freshness }
  }
}

type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

export function financeViewRoutes(service: FinanceViewService): Record<string, Handler> {
  return {
    // The contract declares only x-fapi-interaction-id — the view is always
    // month-to-date (current month). No period query parameter (no spec drift).
    'get /back-office/analytics/finance-view': async (c) => {
      try {
        const { data, freshness } = await service.view(c.get('principal'))
        return c.json({ ...dataEnvelope(data), freshness }, 200)
      } catch (e) {
        const denied = scopeDenied(c, e)
        if (denied) return denied
        if (e instanceof FinanceViewError) {
          return c.json(errorEnvelope(e.code, e.message, 'The Finance View is month-to-date; no parameters are required.', DOCS_BASE), e.status as ContentfulStatusCode)
        }
        throw e
      }
    }
  }
}
