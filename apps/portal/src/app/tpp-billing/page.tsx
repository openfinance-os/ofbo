import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AppShell } from '../../components/app-shell'
import { shellBadges } from '../../lib/shell'
import { TppBilling } from '../../components/tpp-billing'
import { TOKEN_COOKIE } from '../../lib/cookies'
import { SCOPES } from '../../lib/scopes'
import { verifyAndMint } from '../../lib/portal'
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
  const token = (await cookies()).get(TOKEN_COOKIE)?.value
  if (!token) redirect('/')

  let principal
  try {
    principal = await verifyAndMint(token)
  } catch {
    redirect('/')
  }
  if (!principal.superadmin && !principal.scopes.includes(SCOPES.billingRead)) redirect(`/access-denied?module=${encodeURIComponent('TPP Billing & Registry')}&required=${encodeURIComponent(SCOPES.billingRead)}`)

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
        <a href={ar ? `/approvals/${encodeURIComponent(ar)}` : '/approvals'} className="underline font-semibold">
          {ar ? 'Open this approval →' : 'Track in the approvals queue →'}
        </a>
      </>
    ) : (
      NOTICE[status] ?? null
    )

  const regCursor = one(sp.reg_cursor)
  const invCursor = one(sp.inv_cursor)
  let counterparties: TppCounterparty[] = []
  let invoiceRuns: InvoiceRun[] = []
  let registryMoreHref: string | null = null
  let invoiceMoreHref: string | null = null
  let error: string | null = FAILURE[status] ?? null
  let errorRemediation: string | null = null
  let errorDocsUrl: string | null = null
  try {
    const page = await listCounterparties(token, { limit: 50, cursor: regCursor })
    counterparties = page.counterparties
    registryMoreHref = page.next_cursor ? `/tpp-billing?reg_cursor=${encodeURIComponent(page.next_cursor)}` : null
  } catch (e) {
    error = e instanceof TppBillingApiError ? e.message : 'Failed to load the registry.'
    if (e instanceof TppBillingApiError) {
      errorRemediation = e.remediation ?? null
      errorDocsUrl = e.docsUrl ?? null
    }
  }
  try {
    const page = await listInvoiceRuns(token, { limit: 20, cursor: invCursor })
    invoiceRuns = page.runs
    invoiceMoreHref = page.next_cursor ? `/tpp-billing?inv_cursor=${encodeURIComponent(page.next_cursor)}` : null
  } catch {
    error = error ?? 'Failed to load invoice runs.'
  }

  return (
    <AppShell
      badges={token ? await shellBadges(token) : undefined}
      principal={{ subject: principal.subject, persona: principal.persona, scopes: principal.scopes, superadmin: principal.superadmin }}
      active="billing"
    >
      <TppBilling
        counterparties={counterparties}
        invoiceRuns={invoiceRuns}
        registryMoreHref={registryMoreHref}
        invoiceMoreHref={invoiceMoreHref}
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
