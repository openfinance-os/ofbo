import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AppShell } from '../../components/app-shell'
import { OperationsConsole } from '../../components/operations-console'
import { TOKEN_COOKIE } from '../../lib/cookies'
import { SCOPES } from '../../lib/scopes'
import { verifyAndMint } from '../../lib/portal'
import { getOperationsConsole } from '../../lib/operations'
import type { AnalyticsView } from '../../lib/analytics'

/**
 * UI-09 — Operations Console (BACKOFFICE-28; folds in -58 SLO, -66 cert expiry, Ozone
 * connectivity + active outages). Wired over the OpenAPI contract, server-side (httpOnly
 * token never in the browser). platform:operations:read gates the screen; the BFF
 * re-enforces. Read-only — the aggregate ops surface that summarises the other modules.
 */
export const dynamic = 'force-dynamic'

export default async function OperationsPage() {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value
  if (!token) redirect('/')

  let principal
  try {
    principal = await verifyAndMint(token)
  } catch {
    redirect('/')
  }
  if (!principal.superadmin && !principal.scopes.includes(SCOPES.operationsRead)) redirect('/dashboard')

  let view: AnalyticsView | null = null
  let error: string | null = null
  try {
    view = await getOperationsConsole(token)
  } catch {
    error = 'The Operations Console is temporarily unavailable.'
  }

  return (
    <AppShell
      principal={{ subject: principal.subject, persona: principal.persona, scopes: principal.scopes, superadmin: principal.superadmin }}
      active="operations"
    >
      <OperationsConsole view={view} error={error} />
    </AppShell>
  )
}
