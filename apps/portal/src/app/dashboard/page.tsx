import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AppShell } from '../../components/app-shell'
import { AuditPanel } from '../../components/audit-panel'
import { DashboardOverview } from '../../components/dashboard-overview'
import { TOKEN_COOKIE } from '../../lib/cookies'
import { recentAudit, verifyAndMint } from '../../lib/portal'
import { getDashboardKpis } from '../../lib/dashboard'

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

  const [events, kpis] = await Promise.all([
    recentAudit(principal),
    getDashboardKpis(token, { subject: principal.subject, scopes: principal.scopes }).catch(() => [])
  ])
  return (
    <AppShell principal={{ subject: principal.subject, persona: principal.persona, scopes: principal.scopes, superadmin: principal.superadmin }} active="dashboard">
      <h1 className="text-2xl font-semibold mb-6">Dashboard</h1>
      <DashboardOverview kpis={kpis} />
      <AuditPanel events={events} />
    </AppShell>
  )
}
