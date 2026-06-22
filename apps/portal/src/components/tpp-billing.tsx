import type { ReactNode } from 'react'
import { formatMoney, REGISTERABLE_STATES, type InvoiceRun, type TppCounterparty, type TppWriteResult } from '../lib/tpp-billing'
import { Notice, ErrorBanner, LoadMore } from './ui'
import { TppBillingOverview } from './tpp-billing-overview'
import { RegistryFilter } from './tpp-billing/registry-filter'
import { RegisterForm } from './tpp-billing/register-form'
import { InvoiceRunForm } from './tpp-billing/invoice-run-form'
import { SyncForm } from './tpp-billing/sync-form'

/**
 * UI-08 — TPP Billing & Registry, translated from the Stitch "OFBO - TPP Billing &
 * Registry" screen (project 8050269076066130289). Presentational + server-rendered:
 * the consuming-TPP registry (-71), per-row P9 financial-system registration (-72), and
 * monthly invoicing (-73, four-eyes: a run is submitted to the approvals queue, never
 * dispatched inline). Token-only (no raw hex/px). Finance scope. Mutations are server
 * actions, injected so the unit renders without Next.
 */

export interface TppBillingProps {
  counterparties?: TppCounterparty[]
  invoiceRuns?: InvoiceRun[]
  error?: string | null
  errorRemediation?: string | null
  errorDocsUrl?: string | null
  notice?: ReactNode
  registryMoreHref?: string | null
  invoiceMoreHref?: string | null
  /** UIF-08b — active registry filter values (reflected back into the filter form). */
  registrationState?: string
  unbilledOnly?: boolean
  /** billing:write — register P9 + create invoice runs. */
  canBilling?: boolean
  /** platform:operations:write — sync the Trust Framework Directory. */
  canOps?: boolean
  registerAction?: (prevState: TppWriteResult, formData: FormData) => Promise<TppWriteResult>
  syncAction?: (prevState: TppWriteResult, formData: FormData) => Promise<TppWriteResult>
  invoiceRunAction?: (prevState: TppWriteResult, formData: FormData) => Promise<TppWriteResult>
}

const STATUS_TONE: Record<string, string> = {
  production: 'bg-reconciled/10 text-reconciled',
  live: 'bg-reconciled/10 text-reconciled',
  registered: 'bg-reconciled/10 text-reconciled',
  dispatched: 'bg-reconciled/10 text-reconciled',
  pending_registration: 'bg-break/10 text-break',
  pending_approval: 'bg-break/10 text-break',
  directory_only: 'bg-break/10 text-break',
  suspended: 'bg-breach/10 text-breach',
  withheld: 'bg-breach/10 text-breach'
}

export function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? 'bg-surface-container-high text-on-surface-variant'
  return (
    <span data-testid={`status-${status}`} className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${tone}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

export function RegistryTable({ counterparties, canBilling, registerAction, moreHref }: { counterparties: TppCounterparty[]; canBilling?: boolean; registerAction?: TppBillingProps['registerAction']; moreHref?: string | null }) {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm" data-testid="registry">
      <div className="px-4 py-3 border-b border-outline-variant flex items-center gap-2">
        <h2 className="font-bold text-sm text-primary uppercase tracking-widest">Consuming-TPP Registry</h2>
        <span className="bg-secondary-fixed text-on-secondary-fixed px-2 py-0.5 rounded-full text-xs font-bold">{counterparties.length}</span>
      </div>
      <div className="overflow-x-auto">
        {counterparties.length === 0 ? (
          <p className="p-4 text-xs text-on-surface-variant" data-testid="registry-empty">
            No consuming TPPs in the registry.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-on-surface-variant">
                <th scope="col" className="px-4 py-2 text-left font-semibold">TPP</th>
                <th scope="col" className="px-4 py-2 text-left font-semibold">Status</th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">MTD accrual</th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {counterparties.map((c) => {
                const registerable = canBilling && registerAction && !c.financial_system_ref && (REGISTERABLE_STATES as readonly string[]).includes(c.registration_state)
                return (
                  <tr key={c.organisation_id} className="align-top" data-testid={`tpp-${c.organisation_id}`}>
                    <td className="min-w-0 px-4 py-3">
                      <p className="truncate text-sm font-bold text-primary">{c.legal_name}</p>
                      <p className="truncate font-mono text-xs text-on-surface-variant">{c.organisation_id}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill status={c.production_status} />
                        <StatusPill status={c.registration_state} />
                        {c.unbilled_traffic ? <span className="text-xs font-bold text-breach" data-testid={`unbilled-${c.organisation_id}`}>● unbilled traffic</span> : null}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs text-on-surface-variant" data-testid={`accrual-${c.organisation_id}`}>
                      {formatMoney(c.mtd_fee_accrual)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {registerable && registerAction ? <RegisterForm organisationId={c.organisation_id} action={registerAction} /> : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      <LoadMore moreHref={moreHref ?? null} shown={counterparties.length} noun="TPPs" />
    </div>
  )
}

export function InvoiceRunsTable({ invoiceRuns, moreHref }: { invoiceRuns: InvoiceRun[]; moreHref?: string | null }) {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm" data-testid="invoice-runs">
      <div className="px-4 py-3 border-b border-outline-variant">
        <h2 className="font-bold text-sm text-primary uppercase tracking-widest">Monthly Invoice Runs</h2>
      </div>
      <div className="divide-y divide-outline-variant overflow-x-auto">
        {invoiceRuns.length === 0 ? (
          <p className="p-4 text-xs text-on-surface-variant" data-testid="invoice-runs-empty">
            No invoice runs yet.
          </p>
        ) : (
          invoiceRuns.map((r) => (
            <div key={r.invoice_run_id} className="p-4 flex items-center justify-between gap-3" data-testid={`invoice-run-${r.invoice_run_id}`}>
              <div>
                <p className="text-sm font-semibold text-primary">{r.billing_period}</p>
                <p className="text-xs text-on-surface-variant">
                  {r.invoices.length} invoice{r.invoices.length === 1 ? '' : 's'}
                  {r.withheld_line_count > 0 ? ` · ${r.withheld_line_count} withheld` : ''}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-on-surface-variant">{formatMoney(r.net_settlement_offset)}</span>
                <StatusPill status={r.status} />
              </div>
            </div>
          ))
        )}
      </div>
      <LoadMore moreHref={moreHref ?? null} shown={invoiceRuns.length} noun="runs" />
    </div>
  )
}

export function TppBilling({ counterparties = [], invoiceRuns = [], registryMoreHref, invoiceMoreHref, registrationState, unbilledOnly, error, errorRemediation, errorDocsUrl, notice, canBilling, canOps, registerAction, syncAction, invoiceRunAction }: TppBillingProps) {
  return (
    <div className="space-y-6" data-testid="tpp-billing">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">TPP Billing &amp; Registry</h1>
        <div className="flex items-center gap-2">
          {canOps && syncAction ? (
            <SyncForm action={syncAction} />
          ) : null}
          {canBilling && invoiceRunAction ? <InvoiceRunForm action={invoiceRunAction} /> : null}
        </div>
      </div>

      {notice ? <Notice testid="tpp-notice">{notice}</Notice> : null}
      {error ? <ErrorBanner testid="tpp-error" remediation={errorRemediation} docsUrl={errorDocsUrl}>{error}</ErrorBanner> : null}

      {counterparties.length ? <TppBillingOverview counterparties={counterparties} /> : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <RegistryFilter registrationState={registrationState} unbilledOnly={unbilledOnly} />
          <RegistryTable counterparties={counterparties} canBilling={canBilling} registerAction={registerAction} moreHref={registryMoreHref} />
        </div>
        <InvoiceRunsTable invoiceRuns={invoiceRuns} moreHref={invoiceMoreHref} />
      </div>
    </div>
  )
}
