import { AppShell } from '../../components/app-shell'
import { shellBadges } from '../../lib/shell'
import { ComplianceView } from '../../components/compliance-view'
import { SCOPES } from '../../lib/scopes'
import { requireSession } from '../../lib/session'
import { getComplianceView } from '../../lib/compliance'
import type { AnalyticsView } from '../../lib/analytics'

/**
 * Compliance view — closes the app-shell's Compliance nav item with the existing
 * compliance-view analytics surface. Wired over the OpenAPI contract, server-side
 * (httpOnly token never in the browser). compliance:reports:read gates the screen;
 * the BFF re-enforces. Read-only.
 */
export const dynamic = 'force-dynamic'

export default async function CompliancePage() {
  const { token, principal } = await requireSession({ scope: SCOPES.complianceRead, module: 'Compliance' })

  let error: string | null = null
  const [view, badges] = await Promise.all([
    getComplianceView(token).catch((): AnalyticsView | null => {
      error = 'The Compliance view is temporarily unavailable.'
      return null
    }),
    shellBadges(token)
  ])

  return (
    <AppShell badges={badges} principal={principal}>
      <ComplianceView view={view} error={error} />
    </AppShell>
  )
}
