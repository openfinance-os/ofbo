import { AppShell } from '../../components/app-shell'
import { shellBadges } from '../../lib/shell'
import { RiskDashboard } from '../../components/risk-dashboard'
import { SCOPES } from '../../lib/scopes'
import { requireSession } from '../../lib/session'
import { getLiabilityMonitor, getRiskView } from '../../lib/risk'
import { AnalyticsApiError, type AnalyticsView } from '../../lib/analytics'

/**
 * UI-07 — Risk Management & Anomaly Detection (BACKOFFICE-30 Risk View + BACKOFFICE-36
 * liability monitor; -37 anomalies surface as Risk signals in the Risk View). Wired over
 * the OpenAPI contract, server-side (httpOnly token never in the browser). Narrow Risk
 * scope (risk:read) gates the screen; the BFF re-enforces. Read-only — no mutations.
 */
export const dynamic = 'force-dynamic'

export default async function RiskPage() {
  const { token, principal } = await requireSession({ scope: SCOPES.riskRead, module: 'Risk Management' })

  let errorRemediation: string | null = null
  let errorDocsUrl: string | null = null
  const capture = (e: unknown) => {
    if (e instanceof AnalyticsApiError && !errorRemediation) {
      errorRemediation = e.remediation ?? null
      errorDocsUrl = e.docsUrl ?? null
    }
  }
  // Fetch each view (and the shell badge count) independently and in parallel — one
  // failing must not blank the other, and the badge read no longer serialises after them.
  let riskFailed = false
  let liabilityFailed = false
  const [riskView, liabilityMonitor, badges] = await Promise.all([
    getRiskView(token).catch((e): AnalyticsView | null => { riskFailed = true; capture(e); return null }),
    getLiabilityMonitor(token).catch((e): AnalyticsView | null => { liabilityFailed = true; capture(e); return null }),
    shellBadges(token)
  ])
  let error: string | null = riskFailed ? 'The Risk View is temporarily unavailable.' : null
  if (liabilityFailed) error = error ? `${error} The liability monitor is temporarily unavailable.` : 'The liability monitor is temporarily unavailable.'

  return (
    <AppShell badges={badges} principal={principal}>
      <RiskDashboard riskView={riskView} liabilityMonitor={liabilityMonitor} error={error} errorRemediation={errorRemediation} errorDocsUrl={errorDocsUrl} />
    </AppShell>
  )
}
