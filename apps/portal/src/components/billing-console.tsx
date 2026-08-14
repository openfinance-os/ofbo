import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  formatMilliFils,
  humanizeBilling,
  type BillingConsoleView,
  type BillingProfitabilityRow,
  type BillingWriteResult
} from '../lib/billing-console'
import { FreshnessBadge } from './analytics-dashboard'
import { ContributionBar, ErrorBanner, Gauge, KpiStat, SectionCard, StatStrip, StatusBadge } from './ui'
import { IdempotencyField } from './ui/idempotency-field'
import { ProfitabilitySimulator } from './billing/profitability-simulator'

type SimulationAction = (previous: BillingWriteResult, formData: FormData) => Promise<BillingWriteResult>

export interface BillingConsoleProps {
  view?: BillingConsoleView | null
  error?: string | null
  errorRemediation?: string | null
  errorDocsUrl?: string | null
  simulateAction?: SimulationAction
}

const unavailable = <span className="text-sm text-on-surface-variant">Awaiting scheduled billing evidence</span>

function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg bg-surface-container p-3">
      <dt className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-on-surface">{children}</dd>
    </div>
  )
}

function PeriodControl({ period }: { period: string }) {
  return (
    <form method="get" action="/billing" className="flex items-end gap-2" data-testid="period-control">
      <label className="text-xs font-semibold text-on-surface-variant">
        Billing period
        <input name="period" type="month" defaultValue={period} className="mt-1 rounded-lg border border-outline-variant bg-surface-container px-3 py-2 font-mono text-sm text-on-surface" />
      </label>
      <button className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm font-bold text-primary hover:bg-surface-container" type="submit">
        Apply
      </button>
    </form>
  )
}

function RateCardPanel({ view }: { view: BillingConsoleView }) {
  const card = view.data.rate_card
  return (
    <SectionCard title="Resolved rate card" testid="rate-card-panel" meta={card ? <StatusBadge status={card.year_anchor.status} /> : undefined}>
      {card ? (
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <KeyValue label="Version"><span className="font-mono">{card.version}</span></KeyValue>
            <KeyValue label="Effective from"><span className="font-mono">{card.effective_from}</span></KeyValue>
            <KeyValue label="Year-step anchor"><span className="font-mono">{card.year_anchor.date}</span></KeyValue>
            <KeyValue label="Currency">{card.currency}</KeyValue>
          </div>
          <p className="text-xs leading-relaxed text-on-surface-variant">{card.year_anchor.note}</p>
          <ContributionBar label="Rate-card sides" segments={[
            { label: 'Receivable fee classes', value: Object.keys(card.receivable).length },
            { label: 'Hub payable fee classes', value: Object.keys(card.payable_hub).length }
          ]} />
        </div>
      ) : <div className="p-4">{unavailable}</div>}
    </SectionCard>
  )
}

function TenantPolicyPanel({ view }: { view: BillingConsoleView }) {
  const policy = view.data.collection_rail_policy
  return (
    <SectionCard title="Tenant billing policy" testid="tenant-policy-panel">
      <dl className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        <KeyValue label="Invoice template"><span className="font-mono">{view.data.invoice?.template_ref ?? '—'}</span></KeyValue>
        <KeyValue label="Invoice brand">{view.data.invoice?.brand_key ?? '—'}</KeyValue>
        <KeyValue label="ASP route"><span className="font-mono">{view.data.asp_route_profile ?? '—'}</span></KeyValue>
        <KeyValue label="Collection rails">
          {policy ? `${humanizeBilling(policy.preferred)} → ${humanizeBilling(policy.fallback)}` : '—'}
        </KeyValue>
      </dl>
    </SectionCard>
  )
}

function CollectionsPanel({ view }: { view: BillingConsoleView }) {
  const c = view.data.collections
  return (
    <SectionCard title="Collections & settlement" testid="collections-panel" meta={c ? <StatusBadge status={c.settlement_break_count ? 'break' : 'reconciled'} /> : undefined}>
      {c ? (
        <div className="space-y-4 p-4">
          <dl className="grid grid-cols-2 gap-3">
            <KeyValue label="Open invoices">{c.open_invoice_count}</KeyValue>
            <KeyValue label="Open exposure"><span className="font-mono">{formatMilliFils(c.open_milli_fils)}</span></KeyValue>
            <KeyValue label="Settlement residue"><span className="font-mono">{formatMilliFils(c.settlement_residue_milli_fils)}</span></KeyValue>
            <KeyValue label="Settlement breaks">{c.settlement_break_count}</KeyValue>
          </dl>
          {Object.keys(c.dunning_by_state).length ? (
            <ContributionBar label="Dunning states" segments={Object.entries(c.dunning_by_state).map(([label, value]) => ({ label: humanizeBilling(label), value }))} />
          ) : <p className="text-xs text-on-surface-variant">No active dunning cases.</p>}
        </div>
      ) : <div className="p-4">{unavailable}</div>}
    </SectionCard>
  )
}

function ClosePackPanel({ view }: { view: BillingConsoleView }) {
  const pack = view.data.accounting_close_pack
  return (
    <SectionCard title="Accounting close pack" testid="close-pack-panel" meta={pack ? <StatusBadge status={pack.balanced ? 'reconciled' : 'breach'} /> : undefined}>
      {pack ? (
        <dl className="grid grid-cols-2 gap-3 p-4">
          <KeyValue label="Batch"><span className="font-mono">{pack.batch_id}</span></KeyValue>
          <KeyValue label="Journals">{pack.journal_count}</KeyValue>
          <KeyValue label="Debit"><span className="font-mono">AED {(pack.debit_fils / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></KeyValue>
          <KeyValue label="Credit"><span className="font-mono">AED {(pack.credit_fils / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></KeyValue>
        </dl>
      ) : <div className="p-4">{unavailable}</div>}
    </SectionCard>
  )
}

function AssurancePanel({ view }: { view: BillingConsoleView }) {
  const report = view.data.revenue_assurance
  return (
    <SectionCard title="Revenue assurance" testid="assurance-panel" meta={report ? <StatusBadge status={report.target.met ? 'reconciled' : 'breach'} /> : undefined}>
      {report ? (
        <div className="grid grid-cols-1 gap-5 p-4 lg:grid-cols-[auto_1fr]">
          <div className="flex flex-col items-center justify-center rounded-xl bg-surface-container p-4">
            <Gauge value={report.metering_coverage_percent} label="Metering coverage" unit="%" />
            <p className="text-xs font-semibold text-on-surface-variant">Metering coverage</p>
          </div>
          <div className="space-y-3">
            {report.findings.length ? report.findings.slice(0, 5).map((finding) => (
              <div key={`${finding.code}-${finding.title}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-outline-variant p-3">
                <div>
                  <p className="text-sm font-bold text-on-surface">{finding.title}</p>
                  <p className="text-xs text-on-surface-variant">{finding.owner} · <span className="font-mono">{finding.code}</span></p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-bold text-on-surface">{formatMilliFils(finding.amount_milli_fils)}</span>
                  <StatusBadge status={finding.status} />
                </div>
              </div>
            )) : <p className="text-sm text-on-surface-variant">No assurance findings for this period.</p>}
          </div>
        </div>
      ) : <div className="p-4">{unavailable}</div>}
    </SectionCard>
  )
}

function ProfitRows({ rows, keyName }: { rows: BillingProfitabilityRow[]; keyName: 'tpp_id' | 'product_family' }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-outline-variant text-left text-xs uppercase tracking-wider text-on-surface-variant">
            <th scope="col" className="px-4 py-2">{keyName === 'tpp_id' ? 'Counterparty' : 'Product family'}</th>
            <th scope="col" className="px-4 py-2 text-right">Profit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row[keyName] ?? 'row'}-${index}`} className="border-b border-outline-variant/40">
              <td className="px-4 py-2 font-mono text-xs text-on-surface">{row[keyName] ?? '—'}</td>
              <td className="px-4 py-2 text-right font-mono text-xs font-bold text-on-surface">{formatMilliFils(row.profit_milli_fils)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ProfitabilityPanel({ view }: { view: BillingConsoleView }) {
  const report = view.data.profitability
  return (
    <SectionCard title="Profitability ledger" testid="profitability-panel" meta={report ? <StatusBadge status={report.reconciliation.balanced ? 'reconciled' : 'breach'} /> : undefined}>
      {report ? (
        <div className="grid grid-cols-1 divide-y divide-outline-variant xl:grid-cols-2 xl:divide-x xl:divide-y-0">
          <div>
            <p className="px-4 pt-4 text-xs font-bold uppercase tracking-wider text-on-surface-variant">By consuming TPP</p>
            <ProfitRows rows={report.by_tpp} keyName="tpp_id" />
          </div>
          <div>
            <p className="px-4 pt-4 text-xs font-bold uppercase tracking-wider text-on-surface-variant">By product family</p>
            <ProfitRows rows={report.by_product_family} keyName="product_family" />
          </div>
        </div>
      ) : <div className="p-4">{unavailable}</div>}
    </SectionCard>
  )
}

function ExportActions({ period }: { period: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <form action="/api/billing/cbuae-fee-review" method="post" data-testid="cbuae-export-form">
        <input type="hidden" name="period" value={period} />
        <IdempotencyField />
        <button type="submit" className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-xs font-bold text-primary hover:bg-surface-container">
          Generate CBUAE fee-review pack
        </button>
      </form>
      <a href="/api/billing/portable-export" className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-xs font-bold text-primary hover:bg-surface-container">
        Download tenant billing export
      </a>
    </div>
  )
}

/**
 * BILL-09/BILL-10 — LFI billing control plane. Appearance derives from the Stitch
 * TPP Billing & Registry reference (project 8050269076066130289, screen 3d6d14a3),
 * extended with the prototype's period → controls → assurance → profitability hierarchy.
 * Contract data only, token-only, no PII and no insurance economics inferred.
 */
export function BillingConsole({ view, error, errorRemediation, errorDocsUrl, simulateAction }: BillingConsoleProps) {
  const period = view?.data.period ?? new Date().toISOString().slice(0, 7)
  const profit = view?.data.profitability?.totals
  const assurance = view?.data.revenue_assurance
  const collections = view?.data.collections

  return (
    <div className="space-y-6" data-testid="billing-console">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-on-surface">Billing Control Plane</h1>
            {view ? <FreshnessBadge freshness={view.freshness} /> : null}
          </div>
          <p className="mt-1 max-w-3xl text-sm text-on-surface-variant">
            Tenant-owned evidence from independent metering through settlement, accounting close and commercial assurance.
          </p>
          {view ? <p className="mt-2 font-mono text-xs text-on-surface-variant">Tenant {view.data.bank_id}</p> : null}
        </div>
        <PeriodControl period={period} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-outline-variant bg-surface-container p-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="material-symbols-outlined text-secondary" aria-hidden="true">calendar_month</span>
          <span className="text-on-surface-variant">Control period</span>
          <strong className="font-mono text-on-surface" data-testid="billing-period">{period}</strong>
        </div>
        <div className="flex flex-wrap gap-3 text-xs font-bold">
          <Link href="/reconciliation" className="text-primary underline decoration-outline-variant underline-offset-4">Reconciliation</Link>
          <Link href="/tpp-billing" className="text-primary underline decoration-outline-variant underline-offset-4">TPP registry &amp; invoicing</Link>
        </div>
      </div>

      {error ? <ErrorBanner testid="billing-error" remediation={errorRemediation} docsUrl={errorDocsUrl}>{error}</ErrorBanner> : null}

      {view ? (
        <>
          <StatStrip aria-label="Billing control metrics">
            <KpiStat label="Monthly profit" value={formatMilliFils(profit?.profit_milli_fils)} valueTestid="kpi-profit" trend={profit ? { label: profit.profit_milli_fils >= 0 ? 'positive contribution' : 'loss position', tone: profit.profit_milli_fils >= 0 ? 'reconciled' : 'breach' } : undefined} />
            <KpiStat label="Gross receivables" value={formatMilliFils(assurance?.gross_receivable_milli_fils ?? profit?.receivable_milli_fils)} valueTestid="kpi-receivables" />
            <KpiStat label="Revenue leakage" value={assurance ? `${assurance.leakage_percent.toFixed(2)}%` : '—'} valueTestid="kpi-leakage" trend={assurance ? { label: assurance.target.met ? 'below 1% target' : 'target breached', tone: assurance.target.met ? 'reconciled' : 'breach' } : undefined} />
            <KpiStat label="Open exposure" value={formatMilliFils(collections?.open_milli_fils)} valueTestid="kpi-open-exposure" sublabel={collections ? `${collections.open_invoice_count} open invoices` : undefined} />
          </StatStrip>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <RateCardPanel view={view} />
            <TenantPolicyPanel view={view} />
            <CollectionsPanel view={view} />
            <ClosePackPanel view={view} />
          </div>

          <AssurancePanel view={view} />
          <ProfitabilityPanel view={view} />

          <SectionCard title="Fee simulation" testid="simulation-panel" action={<ExportActions period={period} />}>
            {simulateAction ? <ProfitabilitySimulator period={period} action={simulateAction} /> : null}
          </SectionCard>

          <section aria-labelledby="insurance-deferred-heading" data-testid="insurance-deferred" className="rounded-xl border border-break/40 bg-break/10 p-4">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-break" aria-hidden="true">lock_clock</span>
              <div>
                <h2 id="insurance-deferred-heading" className="text-sm font-bold text-on-surface">Insurance commissions remain deferred</h2>
                <p className="mt-1 text-sm text-on-surface-variant">
                  {view.data.insurance.story} is blocked pending an {view.data.insurance.dependency}. This console does not infer commission, cool-off or clawback economics.
                </p>
              </div>
            </div>
          </section>
        </>
      ) : !error ? (
        <p className="text-sm text-on-surface-variant">No tenant billing view is available.</p>
      ) : null}
    </div>
  )
}
