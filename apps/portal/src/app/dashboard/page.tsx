import { AppShell } from '../../components/app-shell'
import { shellBadges } from '../../lib/shell'
import { AuditPanel } from '../../components/audit-panel'
import { DashboardOverview } from '../../components/dashboard-overview'
import { DashboardCharts } from '../../components/dashboard-charts'
import { SystemHealthPanel, FourEyesQueuePanel } from '../../components/dashboard-command'
import { requireSession } from '../../lib/session'
import { recentAudit, DASHBOARD_AUDIT_NOISE } from '../../lib/portal'
import { getDashboardKpis, getDashboardCharts } from '../../lib/dashboard'
import { listPendingApprovals } from '../../lib/approvals'

/** The dashboard inside the UI-01 app shell. The persona/scope echo is absorbed
 *  into the shell's persona badge; the audit trail is the dashboard content. The
 *  session cookie is re-verified through the IdP port on every render; an absent or
 *  invalid session bounces back to sign-in. */
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const { token, principal } = await requireSession()

  // All five reads (incl. the shell badge count) are independent — fetch them in one
  // parallel wave rather than serialising the badge fetch after the page data.
  const [events, kpis, charts, queue, badges] = await Promise.all([
    // Audit read is the only direct-store dependency on this page; degrade it like the
    // BFF-backed panels below so a transient audit-store hiccup empties the AuditPanel
    // instead of 500-ing the whole dashboard. (The fatal audit path stays at sign-in,
    // where an unaudited session is a hard stop — never here, on render.)
    recentAudit(principal, {}, { excludeEventTypes: DASHBOARD_AUDIT_NOISE, limit: 15 }).catch(() => []),
    getDashboardKpis(token, { subject: principal.subject, scopes: principal.scopes }).catch(() => []),
    getDashboardCharts(token).catch(() => ({ reconTrend: [], riskSeverity: [] })),
    listPendingApprovals(token, { limit: 6 }).catch(() => ({ approvals: [], next_cursor: null })),
    shellBadges(token)
  ])
  // UIF-06 — the System-Heartbeat gauge is the latest completed run's reconciliation pass rate.
  const latestTrend = charts.reconTrend.at(-1)
  return (
    <AppShell principal={principal} badges={badges}>
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
