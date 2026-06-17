import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AppShell } from '../../components/app-shell'
import { ApprovalsPortal } from '../../components/approvals-portal'
import { TOKEN_COOKIE } from '../../lib/cookies'
import { verifyAndMint } from '../../lib/portal'
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
  const token = (await cookies()).get(TOKEN_COOKIE)?.value
  if (!token) redirect('/')

  let principal
  try {
    principal = await verifyAndMint(token)
  } catch {
    redirect('/')
  }

  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const status = one(sp.status) ?? ''

  let approvals: ApprovalRequest[] = []
  let error: string | null = FAILURE[status] ?? null
  try {
    approvals = (await listPendingApprovals(token)).approvals
  } catch (e) {
    error = e instanceof ApprovalApiError ? e.message : 'Failed to load pending approvals.'
  }

  return (
    <AppShell
      principal={{ subject: principal.subject, persona: principal.persona, scopes: principal.scopes, superadmin: principal.superadmin }}
      active="approvals"
    >
      <ApprovalsPortal
        approvals={approvals}
        subject={principal.subject}
        scopes={principal.scopes}
        superadmin={principal.superadmin}
        error={error}
        notice={NOTICE[status] ?? null}
        approveAction={approveAction}
        rejectAction={rejectAction}
      />
    </AppShell>
  )
}
