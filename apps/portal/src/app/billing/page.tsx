import { AppShell } from '../../components/app-shell'
import { BillingConsole } from '../../components/billing-console'
import { TppCostConsole } from '../../components/tpp-cost/tpp-cost-console'
import { BillingConsoleApiError, getBillingConsole, type BillingConsoleView } from '../../lib/billing-console'
import { getCostPeriod, TppCostApiError, type TppCostPeriod } from '../../lib/tpp-cost'
import { SCOPES } from '../../lib/scopes'
import { requireSession } from '../../lib/session'
import { shellBadges } from '../../lib/shell'
import { simulateBillingAction } from './actions'
import { dispatchPayableAction, requestCostCloseAction } from './cost-actions'

/**
 * BILL-09/BILL-10 + BILL-17 — the tenant billing control plane, server-rendered and scope-gated.
 *
 * ONE screen, two halves. Receivables (what consuming TPPs owe the bank as an LFI) and payables
 * (what the bank owes the Hub and underlying LFIs as a TPP of record) are two sides of one monthly
 * commercial position; putting them on separate modules would make "what is our net position with
 * the scheme" a question you answer by opening two screens and doing arithmetic.
 *
 * The two halves carry DIFFERENT scopes and are gated independently: the page needs `billing:read`,
 * and the payable write controls additionally need `finance:reconciliation:write`. The BFF
 * re-enforces both.
 */
export const dynamic = 'force-dynamic'

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

export default async function BillingPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { token, principal } = await requireSession({ scope: SCOPES.billingRead, module: 'Billing Control Plane' })
  const params = await searchParams
  const rawPeriod = Array.isArray(params.period) ? params.period[0] : params.period
  const period = rawPeriod && PERIOD.test(rawPeriod) ? rawPeriod : new Date().toISOString().slice(0, 7)
  const approvalRequestId = Array.isArray(params.ar) ? params.ar[0] : params.ar

  let failed: unknown = null
  let costFailed: unknown = null
  // Fetched in parallel and degraded INDEPENDENTLY: the payable half being unavailable must not
  // blank the receivable half, and vice versa. They are separate reads behind separate scopes.
  const [view, costView, badges] = await Promise.all([
    getBillingConsole(token, period).catch((error): BillingConsoleView | null => {
      failed = error
      return null
    }),
    getCostPeriod(token, period).catch((error): TppCostPeriod | null => {
      costFailed = error
      return null
    }),
    shellBadges(token)
  ])
  const typed = failed instanceof BillingConsoleApiError ? failed : null
  const costTyped = costFailed instanceof TppCostApiError ? costFailed : null
  // The payable WRITE controls need the reconciliation write scope on top of billing:read. Gated
  // here so an operator who cannot act is not shown a control that would 403 — and the BFF
  // re-enforces regardless.
  const canWritePayables = principal.superadmin || principal.scopes.includes(SCOPES.reconciliationWrite)

  return (
    <AppShell badges={badges} principal={principal}>
      <BillingConsole
        view={view}
        error={failed ? typed?.message ?? 'The billing control plane is temporarily unavailable.' : null}
        errorRemediation={typed?.remediation ?? null}
        errorDocsUrl={typed?.docsUrl ?? null}
        simulateAction={simulateBillingAction}
      />
      <TppCostConsole
        view={costView}
        period={period}
        canWrite={canWritePayables}
        approvalRequestId={approvalRequestId ?? null}
        error={costFailed ? costTyped?.message ?? 'The TPP cost ledger is temporarily unavailable.' : null}
        errorRemediation={costTyped?.remediation ?? null}
        errorDocsUrl={costTyped?.docsUrl ?? null}
        closeAction={requestCostCloseAction}
        dispatchAction={dispatchPayableAction}
      />
    </AppShell>
  )
}
