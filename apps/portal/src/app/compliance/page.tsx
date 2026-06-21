import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AppShell } from '../../components/app-shell'
import { shellBadges } from '../../lib/shell'
import { ComplianceView } from '../../components/compliance-view'
import { TOKEN_COOKIE } from '../../lib/cookies'
import { SCOPES } from '../../lib/scopes'
import { verifyAndMint } from '../../lib/portal'
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
  const token = (await cookies()).get(TOKEN_COOKIE)?.value
  if (!token) redirect('/')

  let principal
  try {
    principal = await verifyAndMint(token)
  } catch {
    redirect('/')
  }
  if (!principal.superadmin && !principal.scopes.includes(SCOPES.complianceRead)) redirect(`/access-denied?module=${encodeURIComponent('Compliance')}&required=${encodeURIComponent(SCOPES.complianceRead)}`)

  let view: AnalyticsView | null = null
  let error: string | null = null
  try {
    view = await getComplianceView(token)
  } catch {
    error = 'The Compliance view is temporarily unavailable.'
  }

  return (
    <AppShell
      badges={token ? await shellBadges(token) : undefined}
      principal={{ subject: principal.subject, persona: principal.persona, scopes: principal.scopes, superadmin: principal.superadmin }}
      active="compliance"
    >
      <ComplianceView view={view} error={error} />
    </AppShell>
  )
}
