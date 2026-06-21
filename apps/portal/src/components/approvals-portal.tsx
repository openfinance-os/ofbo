import { canActOn, MIN_REJECT_REASON, type ApprovalRequest } from '../lib/approvals'
import { Notice, ErrorBanner, ConfirmSubmit, SubmitButton, IdempotencyField, AuditNote } from './ui'

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
  notice?: string | null
  approveAction?: (formData: FormData) => void | Promise<void>
  rejectAction?: (formData: FormData) => void | Promise<void>
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
        <ApprovalStateBadge state={approval.state} />
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

      {actable && approveAction && rejectAction ? (
        <div className="mt-3 flex flex-col gap-2 border-t border-outline-variant pt-3">
          <form action={approveAction} data-testid={`approve-form-${approval.approval_request_id}`}>
            <IdempotencyField />
            <input type="hidden" name="approval_id" value={approval.approval_request_id} />
            <ConfirmSubmit
              label="Approve"
              confirmLabel="Confirm approval"
              summary={`Approve ${approval.operation_type}. As the second authorised principal, confirming makes the BFF execute this gated operation now.`}
              className="w-full bg-reconciled text-on-error py-1.5 rounded text-xs font-bold hover:opacity-90 transition-opacity"
              testid={`approve-submit-${approval.approval_request_id}`}
            />
          </form>
          <form action={rejectAction} data-testid={`reject-form-${approval.approval_request_id}`} className="space-y-2">
            <IdempotencyField />
            <input type="hidden" name="approval_id" value={approval.approval_request_id} />
            <textarea
              name="reject_reason"
              aria-label="reject reason"
              required
              minLength={MIN_REJECT_REASON}
              placeholder={`Reject reason (≥ ${MIN_REJECT_REASON} chars)…`}
              className="w-full bg-surface-container-lowest text-xs border border-outline-variant rounded px-2 py-1"
            />
            <SubmitButton pendingLabel="Rejecting…" className="w-full bg-breach text-on-error py-1.5 rounded text-xs font-bold hover:bg-error transition-colors">
              Reject
            </SubmitButton>
          </form>
        </div>
      ) : approval.state === 'pending' ? (
        <p className="mt-3 text-xs text-on-surface-variant border-t border-outline-variant pt-3" data-testid={`lockout-${approval.approval_request_id}`}>
          {isInitiator ? 'You initiated this request — a second authorised approver must act (four-eyes).' : `Locked — requires the ${approval.approver_required_scope} scope.`}
        </p>
      ) : null}
    </div>
  )
}

export function ApprovalsPortal({ approvals = [], subject, scopes, superadmin, error, notice, approveAction, rejectAction }: ApprovalsPortalProps) {
  return (
    <div className="space-y-6" data-testid="approvals-portal">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Four-Eyes Approval Portal</h1>
        <AuditNote />
      </div>

      {notice ? <Notice testid="approvals-notice">{notice}</Notice> : null}
      {error ? <ErrorBanner testid="approvals-error">{error}</ErrorBanner> : null}

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
      </section>
    </div>
  )
}
