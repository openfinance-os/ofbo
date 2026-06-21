import { canActOn, type ApprovalRequest, type ApprovalWriteResult } from '../lib/approvals'
import { Notice, ErrorBanner, AuditNote, LoadMore } from './ui'
import { ApproveForm } from './approvals/approve-form'
import { RejectForm } from './approvals/reject-form'
import { OperationSummary } from './operation-summary'

/**
 * UI-05 — Four-Eyes Approval Portal, translated from the Stitch "OFBO - Four-Eyes
 * Approval Portal" screen (project 8050269076066130289). Presentational + server-
 * rendered: the pending-approval queue, each as dual initiator/approver cards with a
 * permission lockout (approve/reject disabled when the principal is the initiator —
 * no self-approval — or lacks the approver scope). NEVER executes inline: approval is
 * a server action that POSTs to the BFF, which runs the gated op on approval. Token-only.
 */

export interface ApprovalsPortalProps {
  approvals?: ApprovalRequest[]
  subject: string
  scopes: string[]
  superadmin?: boolean
  error?: string | null
  errorRemediation?: string | null
  errorDocsUrl?: string | null
  notice?: string | null
  moreHref?: string | null
  approveAction?: (prevState: ApprovalWriteResult, formData: FormData) => Promise<ApprovalWriteResult>
  rejectAction?: (prevState: ApprovalWriteResult, formData: FormData) => Promise<ApprovalWriteResult>
}

const STATE_TONE: Record<string, string> = {
  pending: 'bg-break/10 text-break',
  approved: 'bg-reconciled/10 text-reconciled',
  rejected: 'bg-breach/10 text-breach',
  timed_out: 'bg-surface-container-high text-on-surface-variant'
}

export function ApprovalStateBadge({ state }: { state: string }) {
  const tone = STATE_TONE[state] ?? 'bg-surface-container-high text-on-surface-variant'
  return (
    <span data-testid={`state-${state}`} className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${tone}`}>
      {state}
    </span>
  )
}

/**
 * UX-03 — relative expiry + urgency. Pure (now injected) so it's deterministic in tests.
 * A 2-business-hour default expiry (PRD §10) is unreadable as a raw timestamp; this gives
 * the approver "Expires in 1h 45m" and flags the last 30 minutes.
 */
export function formatExpiry(expiresAt: string, now: number): { label: string; urgent: boolean; expired: boolean } {
  const ms = new Date(expiresAt).getTime() - now
  if (Number.isNaN(ms)) return { label: `Expires ${expiresAt}`, urgent: false, expired: false }
  if (ms <= 0) return { label: 'Expired', urgent: true, expired: true }
  const mins = Math.floor(ms / 60000)
  const h = Math.floor(mins / 60)
  const rel = h > 0 ? `${h}h ${mins % 60}m` : `${mins}m`
  return { label: `Expires in ${rel}`, urgent: mins <= 30, expired: false }
}

export function ApprovalCard({
  approval,
  subject,
  scopes,
  superadmin,
  approveAction,
  rejectAction,
  now = Date.now()
}: {
  approval: ApprovalRequest
  subject: string
  scopes: string[]
  superadmin?: boolean
  approveAction?: ApprovalsPortalProps['approveAction']
  rejectAction?: ApprovalsPortalProps['rejectAction']
  now?: number
}) {
  const expiry = formatExpiry(approval.expires_at, now)
  const actable = canActOn(approval, subject, scopes, superadmin ?? false)
  const isInitiator = approval.initiator === subject
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 shadow-sm" data-testid={`approval-${approval.approval_request_id}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-sm text-primary">{approval.operation_type}</span>
        <div className="flex items-center gap-2 shrink-0">
          <ApprovalStateBadge state={approval.state} />
          {/* UI-MOBILE-APPROVALS — open the focused detail (deep-link / mobile journey) */}
          <a
            href={`/approvals/${approval.approval_request_id}`}
            data-testid={`open-approval-${approval.approval_request_id}`}
            aria-label={`Open approval ${approval.operation_type}`}
            className="font-symbols text-base text-on-surface-variant hover:text-on-surface rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            open_in_new
          </a>
        </div>
      </div>

      {/* dual initiator / approver cards */}
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div className="rounded-lg border border-outline-variant bg-surface-container-low p-3" data-testid="initiator-card">
          <p className="text-xs text-on-surface-variant uppercase tracking-wider">Initiator</p>
          <p className="font-mono text-xs text-primary mt-1 break-all">{approval.initiator}</p>
        </div>
        <div className="rounded-lg border border-outline-variant bg-surface-container-low p-3" data-testid="approver-card">
          <p className="text-xs text-on-surface-variant uppercase tracking-wider">Approver</p>
          <p className="font-mono text-xs text-primary mt-1 break-all">{approval.approver ?? `awaiting · ${approval.approver_required_scope}`}</p>
        </div>
      </div>

      <p className={`text-xs mt-2 ${expiry.urgent ? 'text-breach font-semibold' : 'text-on-surface-variant'}`} data-testid={`expiry-${approval.approval_request_id}`} title={approval.expires_at}>
        {expiry.label}{expiry.urgent && !expiry.expired ? ' · expiring soon' : ''}
      </p>
      {approval.reject_reason ? <p className="text-xs text-breach mt-1">Rejected: {approval.reject_reason}</p> : null}

      <div className="mt-3">
        <OperationSummary summary={approval.operation_summary} testid={`operation-summary-${approval.approval_request_id}`} />
      </div>

      {actable && approveAction && rejectAction ? (
        <div className="mt-3 flex flex-col gap-2 border-t border-outline-variant pt-3">
          <ApproveForm approvalId={approval.approval_request_id} operationType={approval.operation_type} action={approveAction} />
          <RejectForm approvalId={approval.approval_request_id} action={rejectAction} />
        </div>
      ) : approval.state === 'pending' ? (
        <p className="mt-3 text-xs text-on-surface-variant border-t border-outline-variant pt-3" data-testid={`lockout-${approval.approval_request_id}`}>
          {isInitiator ? 'You initiated this request — a second authorised approver must act (four-eyes).' : `Locked — requires the ${approval.approver_required_scope} scope.`}
        </p>
      ) : null}
    </div>
  )
}

export function ApprovalsPortal({ approvals = [], subject, scopes, superadmin, error, errorRemediation, errorDocsUrl, notice, moreHref, approveAction, rejectAction }: ApprovalsPortalProps) {
  return (
    <div className="space-y-6" data-testid="approvals-portal">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Four-Eyes Approval Portal</h1>
        <AuditNote />
      </div>

      {notice ? <Notice testid="approvals-notice">{notice}</Notice> : null}
      {error ? <ErrorBanner testid="approvals-error" remediation={errorRemediation} docsUrl={errorDocsUrl}>{error}</ErrorBanner> : null}

      <section aria-labelledby="pending-approvals-heading" className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm">
        <div className="px-4 py-3 border-b border-outline-variant flex items-center gap-2">
          <h2 id="pending-approvals-heading" className="font-bold text-sm text-primary uppercase tracking-widest">Pending Approvals</h2>
          <span aria-hidden="true" className="bg-break/10 text-break px-2 py-0.5 rounded-full text-xs font-bold">{approvals.length}</span>
          <span className="sr-only">{approvals.length} pending approvals</span>
        </div>
        <div className="p-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
          {approvals.length === 0 ? (
            <p className="text-xs text-on-surface-variant p-1" data-testid="approvals-empty">
              No pending approvals for your scope.
            </p>
          ) : (
            approvals.map((a) => (
              <ApprovalCard key={a.approval_request_id} approval={a} subject={subject} scopes={scopes} superadmin={superadmin} approveAction={approveAction} rejectAction={rejectAction} />
            ))
          )}
        </div>
        <LoadMore moreHref={moreHref ?? null} shown={approvals.length} noun="approvals" />
      </section>
    </div>
  )
}
