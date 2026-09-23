import { AppShell } from '../../components/app-shell'
import { AuditPanel } from '../../components/audit-panel'
import { DashboardOverview } from '../../components/dashboard-overview'
import { DashboardCharts } from '../../components/dashboard-charts'
import { SystemHealthPanel, FourEyesQueuePanel } from '../../components/dashboard-command'
import { requireSession } from '../../lib/session'
import { recentAudit, DASHBOARD_AUDIT_NOISE } from '../../lib/portal'
import { getDashboardKpis, getDashboardCharts, allPendingApprovals, dashboardReadCache } from '../../lib/dashboard'

/** The dashboard inside the UI-01 app shell. The persona/scope echo is absorbed
 *  into the shell's persona badge; the audit trail is the dashboard content. The
 *  session cookie is re-verified through the IdP port on every render; an absent or
 *  invalid session bounces back to sign-in. */
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const { token, principal } = await requireSession()

  // One parallel wave, one trace id, and one shared read cache: the KPI cards, the charts, the
  // four-eyes panel and the nav badge overlap on the risk-signal and pending-approval lists, and
  // each of those reads is a Worker → BFF → Postgres round trip. Reading each list once is what
  // took the super-admin dashboard (the one persona entitled to every source) off ~40s.
  const reads = { traceId: crypto.randomUUID(), shared: dashboardReadCache() }
  const [events, kpis, charts, pending] = await Promise.all([
    // Audit read is the only direct-store dependency on this page; degrade it like the
    // BFF-backed panels below so a transient audit-store hiccup empties the AuditPanel
    // instead of 500-ing the whole dashboard. (The fatal audit path stays at sign-in,
    // where an unaudited session is a hard stop — never here, on render.)
    recentAudit(principal, {}, { excludeEventTypes: DASHBOARD_AUDIT_NOISE, limit: 15 }).catch(() => []),
    getDashboardKpis(token, { subject: principal.subject, scopes: principal.scopes }, reads).catch(() => []),
    getDashboardCharts(token, reads).catch(() => ({ reconTrend: [], riskSeverity: [] })),
    // Tolerant like shellBadges: a failing BFF yields no queue and no badge, not a broken page.
    allPendingApprovals(token, reads).catch(() => ({ items: [], truncated: false }))
  ])
  const queue = { approvals: pending.items.slice(0, 6) }
  const badges: Record<string, number> = pending.items.length > 0 ? { approvals: pending.items.length } : {}
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
