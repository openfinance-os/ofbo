import type {
  AccountingClosePack,
  FeeScenarioResult,
  ProfitabilityAmounts,
  ProfitabilityReport,
  RevenueAssuranceReport,
  TenantRateCard
} from '@ofbo/billing'
import type { TenantPortableBillingExport } from '@ofbo/db'
import type { CollectionsFinanceSummary } from './collections.js'
import type { CbuaeFeeReviewExport } from './profitability.js'
import type { TenantBillingProfile } from './tenant-service.js'

type Rate =
  | TenantRateCard['receivable'][keyof TenantRateCard['receivable']]
  | TenantRateCard['payableHub'][keyof TenantRateCard['payableHub']]

function mapValues<T extends object, U>(record: T, mapper: (value: T[keyof T]) => U): Record<string, U> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, mapper(value as T[keyof T])])
  )
}

function rateWire(rate: Rate): Record<string, unknown> {
  const base = { basis: rate.basis, label: rate.label, cite: rate.cite }
  switch (rate.basis) {
    case 'flat':
      return {
        ...base,
        flat_milli_fils: rate.flatMilliFils,
        ...(rate.batchCapMilliFils === undefined ? {} : { batch_cap_milli_fils: rate.batchCapMilliFils }),
        ...(rate.thresholdMilliFils === undefined ? {} : { threshold_milli_fils: rate.thresholdMilliFils }),
        ...(rate.windowHours === undefined ? {} : { window_hours: rate.windowHours })
      }
    case 'bps_of_value':
      return {
        ...base,
        schedule_basis_points: rate.scheduleBasisPoints,
        cap_milli_fils: rate.capMilliFils,
        free_allowance: {
          per: rate.freeAllowance.per,
          value_milli_fils: rate.freeAllowance.valueMilliFils,
          requires: rate.freeAllowance.requires,
          since: rate.freeAllowance.since
        }
      }
    case 'flat_stepped':
      return { ...base, schedule_milli_fils: rate.scheduleMilliFils }
    case 'per_page':
      return { ...base, flat_milli_fils: rate.flatMilliFils }
    case 'per_page_over_free_tier':
      return {
        ...base,
        free_tier: rate.freeTier,
        overage_milli_fils: rate.overageMilliFils,
        overage_source: rate.overageSource
      }
    case 'tiered_by_providers':
      return {
        ...base,
        tiers: rate.tiers.map((tier) => ({ max_providers: tier.maxProviders, milli_fils: tier.milliFils }))
      }
  }
}

function rateCardWire(rateCard: TenantRateCard): Record<string, unknown> {
  return {
    version: rateCard.version,
    label: rateCard.label,
    effective_from: rateCard.effectiveFrom,
    source: rateCard.source,
    currency: rateCard.currency,
    tenant_id: rateCard.tenantId,
    year_anchor: rateCard.yearAnchor,
    receivable: mapValues(rateCard.receivable, rateWire),
    payable_hub: mapValues(rateCard.payableHub, rateWire),
    reconciliation_unit_rates: mapValues(rateCard.reconciliationUnitRates, (rate) => ({
      milli_fils: rate.milliFils,
      cite: rate.cite
    })),
    // Endpoint paths and fee-class identifiers are data keys, not field names.
    chargeable_endpoints: { ...rateCard.chargeableEndpoints },
    free_endpoints: [...rateCard.freeEndpoints]
  }
}

export function profitabilityAmountsWire(amounts: ProfitabilityAmounts): Record<string, number> {
  return {
    receivable_milli_fils: amounts.receivableMilliFils,
    hub_cost_milli_fils: amounts.hubCostMilliFils,
    // BILL-12: the underlying-LFI cost is a separate external cost from the Hub fee, not folded in.
    lfi_cost_milli_fils: amounts.lfiCostMilliFils,
    liability_provision_milli_fils: amounts.liabilityProvisionMilliFils,
    tpp_aas_margin_milli_fils: amounts.tppAasMarginMilliFils,
    profit_milli_fils: amounts.profitMilliFils
  }
}

export function profitabilityReportWire(report: ProfitabilityReport): Record<string, unknown> {
  const row = (item: ProfitabilityReport['byTpp'][number]) => ({
    ...profitabilityAmountsWire(item),
    ...(item.tppId === undefined ? {} : { tpp_id: item.tppId }),
    ...(item.productFamily === undefined ? {} : { product_family: item.productFamily }),
    source_refs: item.sourceRefs,
    profit_aed: item.profitAed
  })
  return {
    period: report.period,
    currency: report.currency,
    totals: profitabilityAmountsWire(report.totals),
    by_tpp: report.byTpp.map(row),
    by_product_family: report.byProductFamily.map(row),
    reconciliation: {
      balanced: report.reconciliation.balanced,
      delta_milli_fils: report.reconciliation.deltaMilliFils
    }
  }
}

export function feeScenarioResultWire(result: FeeScenarioResult): Record<string, unknown> {
  return {
    scenario_id: result.scenarioId,
    effective_date: result.effectiveDate,
    baseline: profitabilityAmountsWire(result.baseline),
    projected: profitabilityAmountsWire(result.projected),
    delta_profit_milli_fils: result.deltaProfitMilliFils,
    overage: {
      units: result.overage.units,
      silent_default_revenue_milli_fils: result.overage.silentDefaultRevenueMilliFils,
      proposed_revenue_milli_fils: result.overage.proposedRevenueMilliFils,
      incremental_revenue_milli_fils: result.overage.incrementalRevenueMilliFils
    }
  }
}

export function cbuaeFeeReviewWireBody(result: Omit<CbuaeFeeReviewExport, 'sha256'>): Record<string, unknown> {
  return {
    schema_version: result.schemaVersion,
    period: result.period,
    generated_at: result.generatedAt,
    currency: result.currency,
    profitability: profitabilityReportWire(result.profitability),
    scenarios: result.scenarios.map(feeScenarioResultWire)
  }
}

export function cbuaeFeeReviewWire(result: CbuaeFeeReviewExport): Record<string, unknown> {
  return { ...cbuaeFeeReviewWireBody(result), sha256: result.sha256 }
}

export function portableBillingExportWireBody(result: Omit<TenantPortableBillingExport, 'sha256'>): Record<string, unknown> {
  return {
    schema_version: result.schemaVersion,
    bank_id: result.bankId,
    generated_at: result.generatedAt,
    record_counts: result.recordCounts,
    // Rows originate from SELECT to_jsonb(t). Nested jsonb values are opaque and
    // intentionally pass through without reflective key rewriting.
    tables: result.tables
  }
}

export function portableBillingExportWire(result: TenantPortableBillingExport): Record<string, unknown> {
  return { ...portableBillingExportWireBody(result), sha256: result.sha256 }
}

function collectionsWire(summary: CollectionsFinanceSummary): Record<string, unknown> {
  return {
    open_invoice_count: summary.openInvoiceCount,
    open_milli_fils: summary.openMilliFils,
    settlement_break_count: summary.settlementBreakCount,
    settlement_expected_net_milli_fils: summary.settlementExpectedNetMilliFils,
    settlement_received_milli_fils: summary.settlementReceivedMilliFils,
    settlement_residue_milli_fils: summary.settlementResidueMilliFils,
    dunning_by_state: { ...summary.dunningByState },
    dso_by_tpp: summary.dsoByTpp.map((item) => ({
      tpp_id: item.tppId,
      dso_days: item.dsoDays,
      invoice_count: item.invoiceCount,
      open_invoice_count: item.openInvoiceCount,
      open_milli_fils: item.openMilliFils
    }))
  }
}

function accountingWire(pack: AccountingClosePack): Record<string, unknown> {
  return {
    period: pack.period,
    batch_id: pack.batchId,
    account_profile_ref: pack.accountProfileRef,
    balanced: pack.balanced,
    journal_count: pack.journalCount,
    debit_fils: pack.debitFils,
    credit_fils: pack.creditFils,
    output_vat_fils: pack.outputVatFils,
    settlement_residue_fils: pack.settlementResidueFils,
    invoice_document_ids: pack.invoiceDocumentIds,
    payable_source_ids: pack.payableSourceIds,
    settlement_references: pack.settlementReferences
  }
}

function assuranceWire(report: RevenueAssuranceReport): Record<string, unknown> {
  return {
    period: report.period,
    generated_at: report.generatedAt,
    currency: report.currency,
    metering_coverage_percent: report.meteringCoveragePercent,
    gross_receivable_milli_fils: report.grossReceivableMilliFils,
    leakage_milli_fils: report.leakageMilliFils,
    leakage_aed: report.leakageAed,
    leakage_percent: report.leakagePercent,
    counterfactual_opportunity_milli_fils: report.counterfactualOpportunityMilliFils,
    counterfactual_opportunity_aed: report.counterfactualOpportunityAed,
    recoverable_milli_fils: report.recoverableMilliFils,
    recovered_revenue_milli_fils: report.recoveredRevenueMilliFils,
    recovered_revenue_aed: report.recoveredRevenueAed,
    outstanding_recoverable_milli_fils: report.outstandingRecoverableMilliFils,
    findings: report.findings.map((finding) => ({
      code: finding.code,
      title: finding.title,
      amount_milli_fils: finding.amountMilliFils,
      amount_aed: finding.amountAed,
      counterfactual_milli_fils: finding.counterfactualMilliFils,
      counterfactual_aed: finding.counterfactualAed,
      recoverable: finding.recoverable,
      status: finding.status,
      owner: finding.owner,
      source_refs: finding.sourceRefs
    })),
    variance_by_fee_class: report.varianceByFeeClass.map((variance) => ({
      fee_class: variance.feeClass,
      expected_milli_fils: variance.expectedMilliFils,
      memo_milli_fils: variance.memoMilliFils,
      variance_milli_fils: variance.varianceMilliFils
    })),
    recoveries: report.recoveries.map((recovery) => ({
      recovery_id: recovery.recoveryId,
      period: recovery.period,
      finding_code: recovery.findingCode,
      amount_milli_fils: recovery.amountMilliFils,
      recovered_at: recovery.recoveredAt,
      source_ref: recovery.sourceRef
    })),
    dispute_window: {
      raised: report.disputeWindow.raised,
      missed: report.disputeWindow.missed,
      target_missed: report.disputeWindow.targetMissed
    },
    target: {
      threshold_percent: report.target.thresholdPercent,
      comparison: report.target.comparison,
      met: report.target.met
    },
    roi_contribution: {
      fee_variance_recovered_milli_fils: report.roiContribution.feeVarianceRecoveredMilliFils,
      fee_variance_recovered_aed: report.roiContribution.feeVarianceRecoveredAed
    }
  }
}

export interface BillingConsoleOverview {
  bankId: string
  period: string
  profile: TenantBillingProfile
  collections: CollectionsFinanceSummary | null
  accountingClosePack: AccountingClosePack | null
  revenueAssurance: RevenueAssuranceReport | null
  profitability: ProfitabilityReport | null
  insurance: {
    status: 'deferred'
    dependency: 'approved insurance commercial model'
    story: 'BILL-06'
  }
}

export function billingConsoleOverviewWire(overview: BillingConsoleOverview): Record<string, unknown> {
  return {
    bank_id: overview.bankId,
    period: overview.period,
    rate_card: rateCardWire(overview.profile.rateCard),
    invoice: {
      template_ref: overview.profile.invoice.templateRef,
      brand_key: overview.profile.invoice.brandKey
    },
    asp_route_profile: overview.profile.aspRouteProfile,
    collection_rail_policy: overview.profile.collectionRailPolicy,
    collections: overview.collections === null ? null : collectionsWire(overview.collections),
    accounting_close_pack: overview.accountingClosePack === null ? null : accountingWire(overview.accountingClosePack),
    revenue_assurance: overview.revenueAssurance === null ? null : assuranceWire(overview.revenueAssurance),
    profitability: overview.profitability === null ? null : profitabilityReportWire(overview.profitability),
    insurance: overview.insurance
  }
}
