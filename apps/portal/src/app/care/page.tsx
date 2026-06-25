import { AppShell } from '../../components/app-shell'
import { shellBadges } from '../../lib/shell'
import { CareConsole } from '../../components/care-console'
import { SCOPES } from '../../lib/scopes'
import { requireSession } from '../../lib/session'
import { getPsuAuditTrail, searchConsents, CareApiError, type CareTimeline, type ConsentSearchResult, type IdentifierType } from '../../lib/care'
import { createDisputeAction, revokeConsentAction, bulkRevokeAction } from './actions'

/**
 * UI-02 — Customer Care Console (BACKOFFICE-16/-19/-17/-20). The first portal screen
 * wired to the Hono BFF over the OpenAPI contract (server-side; the httpOnly token
 * stays out of the browser). consents:admin gates the screen at this layer; the BFF
 * re-enforces it. The PSU search + 24-month timeline are reads; revoke + dispute are
 * server-action mutations. Rendered inside the UI-01 AppShell. Stitch = appearance.
 */
export const dynamic = 'force-dynamic'

const NOTICE: Record<string, string> = {
  revoked: 'Consent revoked — propagated to Nebras via the egress gateway.',
  dispute_opened: 'Dispute opened. Refund initiation is four-eyes-gated.',
  bulk_revoke_requested: 'Emergency bulk revocation submitted for four-eyes approval — a second consents-admin approver completes it in Approvals.'
}
const FAILURE: Record<string, string> = {
  revoke_failed: 'Revocation failed. Re-check the consent and try again.',
  dispute_failed: 'Could not open the dispute. Re-check the details and try again.'
}

export default async function CarePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token, principal } = await requireSession({ scope: SCOPES.consentsAdmin, module: 'Customer Care' })
  // Start the shell badge count immediately so it overlaps the PSU search round trip below.
  const badgesPromise = shellBadges(token)

  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const identifierType = (one(sp.identifier_type) as IdentifierType) ?? 'bank_customer_id'
  const identifier = one(sp.identifier) ?? ''
  const status = one(sp.status) ?? ''
  const timelineCursor = one(sp.timeline_cursor)

  let result: ConsentSearchResult | null = null
  let timeline: CareTimeline | null = null
  let timelineMoreHref: string | null = null
  let error: string | null = FAILURE[status] ?? null
  let errorRemediation: string | null = null
  let errorDocsUrl: string | null = null

  if (identifier.trim()) {
    try {
      result = await searchConsents(token, identifierType, identifier.trim())
      const canReadAudit = principal.superadmin || principal.scopes.includes(SCOPES.auditRead)
      if (canReadAudit) {
        try {
          timeline = await getPsuAuditTrail(token, result.psu.bank_customer_id, { cursor: timelineCursor })
          if (timeline.next_cursor) {
            // Preserve the active PSU search; page older events via timeline_cursor (UX-04b).
            const q = new URLSearchParams({ identifier_type: identifierType, identifier, timeline_cursor: timeline.next_cursor })
            timelineMoreHref = `/care?${q.toString()}`
          }
        } catch {
          timeline = { events: [], next_cursor: null }
        }
      }
    } catch (e) {
      error = e instanceof CareApiError ? e.message : 'Search failed. Re-check the identifier and try again.'
      if (e instanceof CareApiError) {
        errorRemediation = e.remediation ?? null
        errorDocsUrl = e.docsUrl ?? null
      }
    }
  }

  return (
    <AppShell badges={await badgesPromise} principal={principal}>
      <CareConsole
        query={{ identifier_type: identifierType, identifier }}
        result={result}
        timeline={timeline}
        timelineMoreHref={timelineMoreHref}
        error={error}
        errorRemediation={errorRemediation}
        errorDocsUrl={errorDocsUrl}
        notice={NOTICE[status] ?? null}
        revokeAction={revokeConsentAction}
        bulkRevokeAction={bulkRevokeAction}
        disputeAction={createDisputeAction}
      />
    </AppShell>
  )
}
