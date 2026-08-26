import { AppShell } from '../../components/app-shell'
import { shellBadges } from '../../lib/shell'
import { ComplianceView } from '../../components/compliance-view'
import { StrDraftQueue } from '../../components/str-draft-queue'
import { SCOPES } from '../../lib/scopes'
import { requireSession } from '../../lib/session'
import { getComplianceView } from '../../lib/compliance'
import { listStrDrafts, type StrDraft } from '../../lib/str-drafts'
import type { AnalyticsView } from '../../lib/analytics'

/**
 * Compliance view — closes the app-shell's Compliance nav item with the existing
 * compliance-view analytics surface plus the BACKOFFICE-63 STR draft queue. Wired over the
 * OpenAPI contract, server-side (httpOnly token never in the browser). compliance:reports:read
 * gates the screen; the BFF re-enforces. Read-only — the STR handoff is four-eyes, initiated
 * from the approvals surface.
 */
export const dynamic = 'force-dynamic'

export default async function CompliancePage() {
  const { token, principal } = await requireSession({ scope: SCOPES.complianceRead, module: 'Compliance' })

  let error: string | null = null
  let strError: string | null = null
  const [view, strDrafts, badges] = await Promise.all([
    getComplianceView(token).catch((): AnalyticsView | null => {
      error = 'The Compliance view is temporarily unavailable.'
      return null
    }),
    listStrDrafts(token, { limit: 50 }).catch((): { drafts: StrDraft[]; next_cursor: string | null } => {
      strError = 'The STR draft queue is temporarily unavailable.'
      return { drafts: [], next_cursor: null }
    }),
    shellBadges(token)
  ])

  return (
    <AppShell badges={badges} principal={principal}>
      <div className="space-y-8">
        <ComplianceView view={view} error={error} />
        <StrDraftQueue drafts={strDrafts.drafts} error={strError} />
      </div>
    </AppShell>
  )
}
