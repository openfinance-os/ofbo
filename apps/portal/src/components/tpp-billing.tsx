import type { ReactNode } from 'react'
import { formatMoney, REGISTERABLE_STATES, type InvoiceRun, type TppCounterparty } from '../lib/tpp-billing'
import { Notice, ErrorBanner, LoadMore } from './ui'

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
  notice?: ReactNode
  registryMoreHref?: string | null
  invoiceMoreHref?: string | null
  /** billing:write — register P9 + create invoice runs. */
  canBilling?: boolean
  /** platform:operations:write — sync the Trust Framework Directory. */
  canOps?: boolean
  registerAction?: (formData: FormData) => void | Promise<void>
  syncAction?: (formData: FormData) => void | Promise<void>
  invoiceRunAction?: (formData: FormData) => void | Promise<void>
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
      <div className="divide-y divide-outline-variant">
        {counterparties.length === 0 ? (
          <p className="p-4 text-xs text-on-surface-variant" data-testid="registry-empty">
            No consuming TPPs in the registry.
          </p>
        ) : (
          counterparties.map((c) => {
            const registerable = canBilling && registerAction && !c.financial_system_ref && (REGISTERABLE_STATES as readonly string[]).includes(c.registration_state)
            return (
              <div key={c.organisation_id} className="p-4 flex items-center justify-between gap-4" data-testid={`tpp-${c.organisation_id}`}>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-primary truncate">{c.legal_name}</p>
                  <p className="text-xs font-mono text-on-surface-variant truncate">{c.organisation_id}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <StatusPill status={c.production_status} />
                    <StatusPill status={c.registration_state} />
                    {c.unbilled_traffic ? <span className="text-xs font-bold text-breach" data-testid={`unbilled-${c.organisation_id}`}>● unbilled traffic</span> : null}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono text-xs text-on-surface-variant" data-testid={`accrual-${c.organisation_id}`}>
                    {formatMoney(c.mtd_fee_accrual)}
                  </span>
                  {registerable ? (
                    <form action={registerAction} data-testid={`register-form-${c.organisation_id}`}>
                      <input type="hidden" name="organisation_id" value={c.organisation_id} />
                      <button type="submit" className="bg-secondary text-on-secondary px-3 py-1 rounded text-xs font-bold hover:bg-secondary-container transition-colors">
                        Register P9
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
            )
          })
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
      <div className="divide-y divide-outline-variant">
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

function InvoiceRunForm({ invoiceRunAction }: { invoiceRunAction?: TppBillingProps['invoiceRunAction'] }) {
  if (!invoiceRunAction) return null
  return (
    <form action={invoiceRunAction} data-testid="invoice-run-form" className="flex flex-wrap items-end gap-2">
      <label className="text-xs">
        <span className="block text-on-surface-variant mb-1">Billing period</span>
        <input name="billing_period" placeholder="2026-06" className="bg-surface-container text-xs border border-outline-variant rounded px-2 py-1" />
      </label>
      <label className="text-xs">
        <span className="block text-on-surface-variant mb-1">Record set id</span>
        <input name="record_set_id" placeholder="rec-…" className="bg-surface-container text-xs font-mono border border-outline-variant rounded px-2 py-1" />
      </label>
      <button type="submit" className="bg-primary-container text-on-primary-container px-3 py-1.5 rounded text-xs font-bold hover:opacity-90 transition-opacity">
        Run monthly invoicing
      </button>
    </form>
  )
}

export function TppBilling({ counterparties = [], invoiceRuns = [], registryMoreHref, invoiceMoreHref, error, notice, canBilling, canOps, registerAction, syncAction, invoiceRunAction }: TppBillingProps) {
  return (
    <div className="space-y-6" data-testid="tpp-billing">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">TPP Billing &amp; Registry</h1>
        <div className="flex items-center gap-2">
          {canOps && syncAction ? (
            <form action={syncAction} data-testid="sync-form">
              <button type="submit" className="border border-outline-variant text-on-surface-variant px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-surface-container-low transition-colors">
                Sync directory
              </button>
            </form>
          ) : null}
          {canBilling ? <InvoiceRunForm invoiceRunAction={invoiceRunAction} /> : null}
        </div>
      </div>

      {notice ? <Notice testid="tpp-notice">{notice}</Notice> : null}
      {error ? <ErrorBanner testid="tpp-error">{error}</ErrorBanner> : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RegistryTable counterparties={counterparties} canBilling={canBilling} registerAction={registerAction} moreHref={registryMoreHref} />
        <InvoiceRunsTable invoiceRuns={invoiceRuns} moreHref={invoiceMoreHref} />
      </div>
    </div>
  )
}
