import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { ScopeEcho } from '../../components/scope-echo'
import { AuditPanel } from '../../components/audit-panel'
import { TOKEN_COOKIE } from '../../lib/cookies'
import { recentAudit, verifyAndMint } from '../../lib/portal'

/** The portal shell: admin-scoped echo + the visible audit trail. Re-verifies
 *  the session cookie through the IdP port on every render; an absent or invalid
 *  session bounces back to sign-in. */
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

  const events = await recentAudit(principal)
  return (
    <div className="dashboard">
      <ScopeEcho principal={principal} />
      <AuditPanel events={events} />
    </div>
  )
}
