import { AppShell } from '../../components/app-shell'
import { shellBadges } from '../../lib/shell'
import { ApprovalsPortal } from '../../components/approvals-portal'
import { requireSession } from '../../lib/session'
import { listPendingApprovals, ApprovalApiError, type ApprovalRequest } from '../../lib/approvals'
import { approveAction, rejectAction } from './actions'

/**
 * UI-05 — Four-Eyes Approval Portal (BACKOFFICE-44). Cross-cutting: any authenticated
 * persona sees the pending requests they hold the approver_required_scope for (the BFF
 * filters server-side). Wired over the OpenAPI contract, server-side (httpOnly token
 * never in the browser). Approve/reject are server-action mutations; the BFF runs the
 * gated operation on approval (initiator ≠ approver). Rendered inside the UI-01 AppShell.
 */
export const dynamic = 'force-dynamic'

const NOTICE: Record<string, string> = {
  approved: 'Approved — the gated operation was executed by the BFF.',
  rejected: 'Request rejected.'
}
const FAILURE: Record<string, string> = {
  approve_failed: 'Could not approve. You may be the initiator, lack the approver scope, or it expired.',
  reject_failed: 'Could not reject. Provide a reason of at least 10 characters.'
}

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token, principal } = await requireSession()

  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const status = one(sp.status) ?? ''
  const cursor = one(sp.cursor)

  let approvals: ApprovalRequest[] = []
  let moreHref: string | null = null
  let error: string | null = FAILURE[status] ?? null
  let errorRemediation: string | null = null
  let errorDocsUrl: string | null = null
  const [page, badges] = await Promise.all([
    listPendingApprovals(token, { cursor }).catch((e: unknown) => {
      error = e instanceof ApprovalApiError ? e.message : 'Failed to load pending approvals.'
      if (e instanceof ApprovalApiError) {
        errorRemediation = e.remediation ?? null
        errorDocsUrl = e.docsUrl ?? null
      }
      return null
    }),
    shellBadges(token)
  ])
  if (page) {
    approvals = page.approvals
    moreHref = page.next_cursor ? `/approvals?cursor=${encodeURIComponent(page.next_cursor)}` : null
  }

  return (
    <AppShell badges={badges} principal={principal}>
      <ApprovalsPortal
        approvals={approvals}
        subject={principal.subject}
        scopes={principal.scopes}
        superadmin={principal.superadmin}
        error={error}
        errorRemediation={errorRemediation}
        errorDocsUrl={errorDocsUrl}
        notice={NOTICE[status] ?? null}
        moreHref={moreHref}
        approveAction={approveAction}
        rejectAction={rejectAction}
      />
    </AppShell>
  )
}
