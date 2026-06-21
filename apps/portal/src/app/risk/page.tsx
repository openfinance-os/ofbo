import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AppShell } from '../../components/app-shell'
import { RiskDashboard } from '../../components/risk-dashboard'
import { TOKEN_COOKIE } from '../../lib/cookies'
import { SCOPES } from '../../lib/scopes'
import { verifyAndMint } from '../../lib/portal'
import { getLiabilityMonitor, getRiskView } from '../../lib/risk'
import type { AnalyticsView } from '../../lib/analytics'

/**
 * UI-07 — Risk Management & Anomaly Detection (BACKOFFICE-30 Risk View + BACKOFFICE-36
 * liability monitor; -37 anomalies surface as Risk signals in the Risk View). Wired over
 * the OpenAPI contract, server-side (httpOnly token never in the browser). Narrow Risk
 * scope (risk:read) gates the screen; the BFF re-enforces. Read-only — no mutations.
 */
export const dynamic = 'force-dynamic'

export default async function RiskPage() {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value
  if (!token) redirect('/')

  let principal
  try {
    principal = await verifyAndMint(token)
  } catch {
    redirect('/')
  }
  if (!principal.superadmin && !principal.scopes.includes(SCOPES.riskRead)) redirect(`/access-denied?module=${encodeURIComponent('Risk Management')}&required=${encodeURIComponent(SCOPES.riskRead)}`)

  let riskView: AnalyticsView | null = null
  let liabilityMonitor: AnalyticsView | null = null
  let error: string | null = null
  // Fetch each view independently — one failing must not blank the other.
  try {
    riskView = await getRiskView(token)
  } catch {
    error = 'The Risk View is temporarily unavailable.'
  }
  try {
    liabilityMonitor = await getLiabilityMonitor(token)
  } catch {
    error = error ? `${error} The liability monitor is temporarily unavailable.` : 'The liability monitor is temporarily unavailable.'
  }

  return (
    <AppShell
      principal={{ subject: principal.subject, persona: principal.persona, scopes: principal.scopes, superadmin: principal.superadmin }}
      active="risk"
    >
      <RiskDashboard riskView={riskView} liabilityMonitor={liabilityMonitor} error={error} />
    </AppShell>
  )
}
