import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AppShell } from '../../components/app-shell'
import { shellBadges } from '../../lib/shell'
import { AnalyticsDashboard } from '../../components/analytics-dashboard'
import { TOKEN_COOKIE } from '../../lib/cookies'
import { SCOPES } from '../../lib/scopes'
import { verifyAndMint } from '../../lib/portal'
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
  const token = (await cookies()).get(TOKEN_COOKIE)?.value
  if (!token) redirect('/')

  let principal
  try {
    principal = await verifyAndMint(token)
  } catch {
    redirect('/')
  }

  const canExec = principal.superadmin || principal.scopes.includes(EXEC_SCOPE)
  const canFinance = principal.superadmin || principal.scopes.includes(FINANCE_SCOPE)
  if (!canExec && !canFinance) redirect(`/access-denied?module=${encodeURIComponent('Analytics & Insights')}&required=${encodeURIComponent(`${EXEC_SCOPE} or ${FINANCE_SCOPE}`)}`)

  let executive: AnalyticsView | null = null
  let finance: AnalyticsView | null = null
  let error: string | null = null
  let errorRemediation: string | null = null
  let errorDocsUrl: string | null = null
  // Capture the typed error's remediation/docs_url (first one wins) for the banner (UX-06).
  const capture = (e: unknown) => {
    if (e instanceof AnalyticsApiError && !errorRemediation) {
      errorRemediation = e.remediation ?? null
      errorDocsUrl = e.docsUrl ?? null
    }
  }
  // Fetch each entitled view independently — one failing must not blank the other.
  if (canExec) {
    try {
      executive = await getExecutiveDashboard(token)
    } catch (e) {
      error = 'The Executive Dashboard is temporarily unavailable.'
      capture(e)
    }
  }
  if (canFinance) {
    try {
      finance = await getFinanceView(token)
    } catch (e) {
      error = error ? `${error} The Finance View is temporarily unavailable.` : 'The Finance View is temporarily unavailable.'
      capture(e)
    }
  }

  return (
    <AppShell
      badges={token ? await shellBadges(token) : undefined}
      principal={{ subject: principal.subject, persona: principal.persona, scopes: principal.scopes, superadmin: principal.superadmin }}
      active="analytics"
    >
      <AnalyticsDashboard executive={executive} finance={finance} error={error} errorRemediation={errorRemediation} errorDocsUrl={errorDocsUrl} />
    </AppShell>
  )
}
