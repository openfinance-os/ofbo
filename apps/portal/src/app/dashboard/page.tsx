import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AppShell } from '../../components/app-shell'
import { shellBadges } from '../../lib/shell'
import { AuditPanel } from '../../components/audit-panel'
import { DashboardOverview } from '../../components/dashboard-overview'
import { DashboardCharts } from '../../components/dashboard-charts'
import { SystemHealthPanel, FourEyesQueuePanel } from '../../components/dashboard-command'
import { TOKEN_COOKIE } from '../../lib/cookies'
import { recentAudit, verifyAndMint, DASHBOARD_AUDIT_NOISE } from '../../lib/portal'
import { getDashboardKpis, getDashboardCharts } from '../../lib/dashboard'
import { listPendingApprovals } from '../../lib/approvals'

/** The dashboard inside the UI-01 app shell. The persona/scope echo is absorbed
 *  into the shell's persona badge; the audit trail is the dashboard content. The
 *  session cookie is re-verified through the IdP port on every render; an absent or
 *  invalid session bounces back to sign-in. */
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value
  if (!token) redirect('/')

  let principal
  try {
    principal = await verifyAndMint(token)
  } catch {
    redirect('/')
  }

  const [events, kpis, charts, queue] = await Promise.all([
    recentAudit(principal, {}, { excludeEventTypes: DASHBOARD_AUDIT_NOISE, limit: 15 }),
    getDashboardKpis(token, { subject: principal.subject, scopes: principal.scopes }).catch(() => []),
    getDashboardCharts(token).catch(() => ({ reconTrend: [], riskSeverity: [] })),
    listPendingApprovals(token, { limit: 6 }).catch(() => ({ approvals: [], next_cursor: null }))
  ])
  // UIF-06 — the System-Heartbeat gauge is the latest completed run's reconciliation pass rate.
  const latestTrend = charts.reconTrend.at(-1)
  return (
    <AppShell principal={{ subject: principal.subject, persona: principal.persona, scopes: principal.scopes, superadmin: principal.superadmin }} active="dashboard" badges={token ? await shellBadges(token) : undefined}>
      <h1 className="text-2xl font-semibold mb-6">Dashboard</h1>
      <section className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2" aria-label="executive command">
        {latestTrend ? <SystemHealthPanel passRate={latestTrend.pct} /> : null}
        <FourEyesQueuePanel approvals={queue.approvals} />
      </section>
      <DashboardOverview kpis={kpis} />
      <DashboardCharts reconTrend={charts.reconTrend} riskSeverity={charts.riskSeverity} />
      <AuditPanel events={events} />
    </AppShell>
  )
}
