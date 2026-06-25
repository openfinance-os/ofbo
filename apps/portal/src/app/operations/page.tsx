import { AppShell } from '../../components/app-shell'
import { shellBadges } from '../../lib/shell'
import { OperationsConsole } from '../../components/operations-console'
import { SCOPES } from '../../lib/scopes'
import { requireSession } from '../../lib/session'
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
  const { token, principal } = await requireSession({ scope: SCOPES.operationsRead, module: 'Operations Console' })

  let error: string | null = null
  const [view, badges] = await Promise.all([
    getOperationsConsole(token).catch((): AnalyticsView | null => {
      error = 'The Operations Console is temporarily unavailable.'
      return null
    }),
    shellBadges(token)
  ])

  return (
    <AppShell badges={badges} principal={principal}>
      <OperationsConsole view={view} error={error} />
    </AppShell>
  )
}
