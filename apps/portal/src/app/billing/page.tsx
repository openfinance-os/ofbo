import { AppShell } from '../../components/app-shell'
import { BillingConsole } from '../../components/billing-console'
import { BillingConsoleApiError, getBillingConsole, type BillingConsoleView } from '../../lib/billing-console'
import { SCOPES } from '../../lib/scopes'
import { requireSession } from '../../lib/session'
import { shellBadges } from '../../lib/shell'
import { simulateBillingAction } from './actions'

/** BILL-09/BILL-10 — tenant LFI billing control plane, server-rendered and scope-gated. */
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

  let failed: unknown = null
  const [view, badges] = await Promise.all([
    getBillingConsole(token, period).catch((error): BillingConsoleView | null => {
      failed = error
      return null
    }),
    shellBadges(token)
  ])
  const typed = failed instanceof BillingConsoleApiError ? failed : null

  return (
    <AppShell badges={badges} principal={principal}>
      <BillingConsole
        view={view}
        error={failed ? typed?.message ?? 'The billing control plane is temporarily unavailable.' : null}
        errorRemediation={typed?.remediation ?? null}
        errorDocsUrl={typed?.docsUrl ?? null}
        simulateAction={simulateBillingAction}
      />
    </AppShell>
  )
}
