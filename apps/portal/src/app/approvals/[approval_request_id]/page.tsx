import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AppShell } from '../../../components/app-shell'
import { ApprovalDetail } from '../../../components/approval-detail'
import { Notice } from '../../../components/ui'
import { shellBadges } from '../../../lib/shell'
import { TOKEN_COOKIE } from '../../../lib/cookies'
import { verifyAndMint } from '../../../lib/portal'
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
  const token = (await cookies()).get(TOKEN_COOKIE)?.value
  if (!token) redirect('/')
  let principal
  try {
    principal = await verifyAndMint(token)
  } catch {
    redirect('/')
  }

  const { approval_request_id } = await params
  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const status = one(sp.status) ?? ''

  let approval: ApprovalRequest | null = null
  let error: string | null = status.endsWith('_failed') ? 'The action could not be completed — it may have expired or already been actioned.' : null
  try {
    approval = await getApproval(token, approval_request_id)
  } catch (e) {
    error = e instanceof ApprovalApiError ? e.message : 'This approval request could not be loaded.'
  }

  return (
    <AppShell
      principal={{ subject: principal.subject, persona: principal.persona, scopes: principal.scopes, superadmin: principal.superadmin }}
      active="approvals"
      badges={await shellBadges(token)}
    >
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
          <a href="/approvals" className="inline-flex items-center gap-1 text-sm text-secondary hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" data-testid="back-to-queue">
            <span className="font-symbols text-base" aria-hidden>arrow_back</span>
            Approval queue
          </a>
          <Notice testid="approval-missing">{error ?? 'This approval request is not available.'}</Notice>
        </div>
      )}
    </AppShell>
  )
}
