import { AppShell } from '../../components/app-shell'
import { shellBadges } from '../../lib/shell'
import { AnalyticsDashboard } from '../../components/analytics-dashboard'
import { SCOPES } from '../../lib/scopes'
import { requireSession } from '../../lib/session'
import { getExecutiveDashboard, getFinanceView, AnalyticsApiError, type AnalyticsView } from '../../lib/analytics'

/**
 * UI-06 — Analytics & Insights Dashboard (BACKOFFICE-27 Executive + BACKOFFICE-31 Finance,
 * with the BACKOFFICE-40 freshness indicator). Wired over the OpenAPI contract, server-side
 * (httpOnly token never in the browser). Each section is entitlement-gated: the Executive
 * Dashboard needs platform:analytics:read, the Finance View needs reconciliation:read (both
 * re-enforced at the BFF). A principal with neither is bounced. Read-only — no mutations.
 */
export const dynamic = 'force-dynamic'

const EXEC_SCOPE = SCOPES.analyticsRead
const FINANCE_SCOPE = SCOPES.reconciliationRead

export default async function AnalyticsPage() {
  const { token, principal } = await requireSession({ scope: [EXEC_SCOPE, FINANCE_SCOPE], module: 'Analytics & Insights' })

  const canExec = principal.superadmin || principal.scopes.includes(EXEC_SCOPE)
  const canFinance = principal.superadmin || principal.scopes.includes(FINANCE_SCOPE)

  let errorRemediation: string | null = null
  let errorDocsUrl: string | null = null
  // Capture the typed error's remediation/docs_url (first one wins) for the banner (UX-06).
  const capture = (e: unknown) => {
    if (e instanceof AnalyticsApiError && !errorRemediation) {
      errorRemediation = e.remediation ?? null
      errorDocsUrl = e.docsUrl ?? null
    }
  }
  // Fetch each entitled view (and the badge count) independently and in parallel — one
  // failing must not blank the other, and the badge read no longer serialises after them.
  let execFailed = false
  let financeFailed = false
  const [executive, finance, badges] = await Promise.all([
    canExec
      ? getExecutiveDashboard(token).catch((e): AnalyticsView | null => { execFailed = true; capture(e); return null })
      : Promise.resolve<AnalyticsView | null>(null),
    canFinance
      ? getFinanceView(token).catch((e): AnalyticsView | null => { financeFailed = true; capture(e); return null })
      : Promise.resolve<AnalyticsView | null>(null),
    shellBadges(token)
  ])
  let error: string | null = execFailed ? 'The Executive Dashboard is temporarily unavailable.' : null
  if (financeFailed) error = error ? `${error} The Finance View is temporarily unavailable.` : 'The Finance View is temporarily unavailable.'

  return (
    <AppShell badges={badges} principal={principal}>
      <AnalyticsDashboard executive={executive} finance={finance} error={error} errorRemediation={errorRemediation} errorDocsUrl={errorDocsUrl} />
    </AppShell>
  )
}
