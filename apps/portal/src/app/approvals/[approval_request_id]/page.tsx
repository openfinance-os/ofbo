import Link from 'next/link'
import { AppShell } from '../../../components/app-shell'
import { ApprovalDetail } from '../../../components/approval-detail'
import { Notice } from '../../../components/ui'
import { shellBadges } from '../../../lib/shell'
import { requireSession } from '../../../lib/session'
import { getApproval, ApprovalApiError, type ApprovalRequest } from '../../../lib/approvals'
import { approveAction, rejectAction } from '../actions'

/**
 * UI-MOBILE-APPROVALS — focused single-approval detail route. The deep-link target for the
 * UX-03 four-eyes initiator link / a push notification: open one request and act on it (the
 * mobile, time-sensitive journey). Scope is BFF-enforced (the request is only fetchable by a
 * principal entitled to see it); the portal re-verifies the session. force-dynamic.
 */
export const dynamic = 'force-dynamic'

const NOTICE: Record<string, string> = {
  approved: 'Approved — the gated operation was executed by the BFF.',
  rejected: 'Rejected — the request was declined and the initiator notified.'
}

export default async function ApprovalDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ approval_request_id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { token, principal } = await requireSession()

  const { approval_request_id } = await params
  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const status = one(sp.status) ?? ''

  let error: string | null = status.endsWith('_failed') ? 'The action could not be completed — it may have expired or already been actioned.' : null
  const [approval, badges] = await Promise.all([
    getApproval(token, approval_request_id).catch((e: unknown): ApprovalRequest | null => {
      error = e instanceof ApprovalApiError ? e.message : 'This approval request could not be loaded.'
      return null
    }),
    shellBadges(token)
  ])

  return (
    <AppShell principal={principal} badges={badges}>
      {approval ? (
        <ApprovalDetail
          approval={approval}
          subject={principal.subject}
          scopes={principal.scopes}
          superadmin={principal.superadmin}
          notice={NOTICE[status] ?? null}
          error={error}
          approveAction={approveAction}
          rejectAction={rejectAction}
        />
      ) : (
        <div className="mx-auto w-full max-w-lg space-y-3" data-testid="approval-detail-missing">
          <Link href="/approvals" className="inline-flex items-center gap-1 text-sm text-secondary hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" data-testid="back-to-queue">
            <span className="font-symbols text-base" aria-hidden>arrow_back</span>
            Approval queue
          </Link>
          <Notice testid="approval-missing">{error ?? 'This approval request is not available.'}</Notice>
        </div>
      )}
    </AppShell>
  )
}
