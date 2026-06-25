import type { ReactNode } from 'react'
import Link from 'next/link'
import { AppShell } from '../../components/app-shell'
import { shellBadges } from '../../lib/shell'
import { TppBilling } from '../../components/tpp-billing'
import { SCOPES } from '../../lib/scopes'
import { requireSession } from '../../lib/session'
import { listCounterparties, listInvoiceRuns, TppBillingApiError, type InvoiceRun, type TppCounterparty } from '../../lib/tpp-billing'
import { createInvoiceRunAction, registerFinancialSystemAction, syncDirectoryAction } from './actions'

/**
 * UI-08 — TPP Billing & Registry (BACKOFFICE-71 registry + -72 P9 registration + -73
 * monthly invoicing). Wired over the OpenAPI contract, server-side (httpOnly token never
 * in the browser). billing:read gates the screen; billing:write gates registration + invoice
 * runs; platform:operations:write gates the directory sync (all re-enforced at the BFF).
 * Invoice-run creation is four-eyes — submitted to the approvals queue, never dispatched inline.
 */
export const dynamic = 'force-dynamic'

const NOTICE: Record<string, string> = {
  synced: 'Registry synced from the Trust Framework Directory.',
  registered: 'Counterparty registered in the P9 financial-management system.',
  invoice_submitted: 'Invoice run submitted to four-eyes — a second authorised principal approves before P9 dispatch.'
}
const FAILURE: Record<string, string> = {
  sync_failed: 'Directory sync failed. Try again.',
  register_failed: 'Could not register the counterparty. It may already be registered.',
  invoice_failed: 'Could not create the invoice run. The record set must be reconciled with all breaks cleared.'
}

export default async function TppBillingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token, principal } = await requireSession({ scope: SCOPES.billingRead, module: 'TPP Billing & Registry' })

  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const status = one(sp.status) ?? ''
  const ar = one(sp.ar)
  const canBilling = principal.superadmin || principal.scopes.includes(SCOPES.billingWrite)
  const canOps = principal.superadmin || principal.scopes.includes(SCOPES.operationsWrite)

  // UX-03 — on a four-eyes submit, give the initiator the request id + a deep-link to track it.
  const notice: ReactNode =
    status === 'invoice_submitted' ? (
      <>
        Invoice run submitted to four-eyes{ar ? <> — request <span className="font-mono">{ar}</span></> : null}. A second authorised principal approves before P9 dispatch.{' '}
        {/* UI-MOBILE-APPROVALS — deep-link straight to the focused approval detail when we know its id. */}
        <Link href={ar ? `/approvals/${encodeURIComponent(ar)}` : '/approvals'} className="underline font-semibold">
          {ar ? 'Open this approval →' : 'Track in the approvals queue →'}
        </Link>
      </>
    ) : (
      NOTICE[status] ?? null
    )

  const regCursor = one(sp.reg_cursor)
  const invCursor = one(sp.inv_cursor)
  // UIF-08b — scope-aware registry filter (the BFF filters server-side via CounterpartyQuery).
  const regState = one(sp.reg_state) ?? ''
  const unbilledOnly = one(sp.unbilled) === '1'
  let counterparties: TppCounterparty[] = []
  let invoiceRuns: InvoiceRun[] = []
  let registryMoreHref: string | null = null
  let invoiceMoreHref: string | null = null
  let error: string | null = FAILURE[status] ?? null
  let errorRemediation: string | null = null
  let errorDocsUrl: string | null = null
  // Registry + invoice-run reads (and the badge count) are independent — fetch in parallel.
  let registryFailedMsg: string | null = null
  let invoiceFailed = false
  const [regPage, invPage, badges] = await Promise.all([
    listCounterparties(token, {
      limit: 50,
      cursor: regCursor,
      ...(regState ? { registration_state: regState } : {}),
      ...(unbilledOnly ? { unbilled_traffic: true } : {})
    }).catch((e: unknown) => {
      registryFailedMsg = e instanceof TppBillingApiError ? e.message : 'Failed to load the registry.'
      if (e instanceof TppBillingApiError) {
        errorRemediation = e.remediation ?? null
        errorDocsUrl = e.docsUrl ?? null
      }
      return null
    }),
    listInvoiceRuns(token, { limit: 20, cursor: invCursor }).catch(() => {
      invoiceFailed = true
      return null
    }),
    shellBadges(token)
  ])
  if (regPage) {
    counterparties = regPage.counterparties
    if (regPage.next_cursor) {
      const p = new URLSearchParams()
      if (regState) p.set('reg_state', regState)
      if (unbilledOnly) p.set('unbilled', '1')
      p.set('reg_cursor', regPage.next_cursor)
      registryMoreHref = `/tpp-billing?${p.toString()}`
    }
  } else {
    // A registry failure takes the banner (mirrors the original sequential precedence).
    error = registryFailedMsg
  }
  if (invPage) {
    invoiceRuns = invPage.runs
    invoiceMoreHref = invPage.next_cursor ? `/tpp-billing?inv_cursor=${encodeURIComponent(invPage.next_cursor)}` : null
  } else if (invoiceFailed) {
    error = error ?? 'Failed to load invoice runs.'
  }

  return (
    <AppShell badges={badges} principal={principal}>
      <TppBilling
        counterparties={counterparties}
        invoiceRuns={invoiceRuns}
        registryMoreHref={registryMoreHref}
        invoiceMoreHref={invoiceMoreHref}
        registrationState={regState || undefined}
        unbilledOnly={unbilledOnly}
        error={error}
        errorRemediation={errorRemediation}
        errorDocsUrl={errorDocsUrl}
        notice={notice}
        canBilling={canBilling}
        canOps={canOps}
        registerAction={registerFinancialSystemAction}
        syncAction={syncDirectoryAction}
        invoiceRunAction={createInvoiceRunAction}
      />
    </AppShell>
  )
}
