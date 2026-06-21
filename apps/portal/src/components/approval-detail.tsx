import type { ApprovalRequest } from '../lib/approvals'
import { canActOn } from '../lib/approvals'
import { ApprovalStateBadge, formatExpiry, type ApprovalsPortalProps } from './approvals-portal'
import { ApproveForm } from './approvals/approve-form'
import { RejectForm } from './approvals/reject-form'
import { OperationSummary } from './operation-summary'
import { Notice, ErrorBanner, AuditNote } from './ui'

/**
 * UI-MOBILE-APPROVALS (ADR 0013 Option 1) — the Stitch "Mobile Approval Detail" journey: a
 * focused, single-column, large-touch-target view of ONE four-eyes request, the natural
 * deep-link target for the UX-03 initiator link / a push notification (time-sensitive 2h
 * expiry). Reuses the queue's formatExpiry/canActOn + the UX-06c useActionState approve/reject
 * islands. Shows only the PII-redacted contract fields (operation context awaits ADR 0014).
 */
export function ApprovalDetail({
  approval,
  subject,
  scopes,
  superadmin,
  notice,
  error,
  approveAction,
  rejectAction,
  now = Date.now()
}: {
  approval: ApprovalRequest
  subject: string
  scopes: string[]
  superadmin?: boolean
  notice?: string | null
  error?: string | null
  approveAction?: ApprovalsPortalProps['approveAction']
  rejectAction?: ApprovalsPortalProps['rejectAction']
  now?: number
}) {
  const expiry = formatExpiry(approval.expires_at, now)
  const actable = canActOn(approval, subject, scopes, superadmin ?? false)
  const isInitiator = approval.initiator === subject

  return (
    <div className="mx-auto w-full max-w-lg space-y-4" data-testid="approval-detail">
      <a href="/approvals" className="inline-flex items-center gap-1 text-sm text-secondary hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" data-testid="back-to-queue">
        <span className="font-symbols text-base" aria-hidden>arrow_back</span>
        Approval queue
      </a>

      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{approval.operation_type}</h1>
        <ApprovalStateBadge state={approval.state} />
      </div>

      {notice ? <Notice testid="approval-notice">{notice}</Notice> : null}
      {error ? <ErrorBanner testid="approval-error">{error}</ErrorBanner> : null}

      <p className={`text-sm ${expiry.urgent ? 'text-breach font-semibold' : 'text-on-surface-variant'}`} data-testid="approval-expiry" title={approval.expires_at}>
        {expiry.label}
        {expiry.urgent && !expiry.expired ? ' · expiring soon' : ''}
      </p>

      <OperationSummary summary={approval.operation_summary} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-lg border border-outline-variant bg-surface-container-low p-3" data-testid="initiator-card">
          <p className="text-xs text-on-surface-variant uppercase tracking-wider">Initiator</p>
          <p className="font-mono text-xs text-primary mt-1 break-all">{approval.initiator}</p>
        </div>
        <div className="rounded-lg border border-outline-variant bg-surface-container-low p-3" data-testid="approver-card">
          <p className="text-xs text-on-surface-variant uppercase tracking-wider">Approver</p>
          <p className="font-mono text-xs text-primary mt-1 break-all">{approval.approver ?? `awaiting · ${approval.approver_required_scope}`}</p>
        </div>
      </div>

      {approval.reject_reason ? (
        <p className="text-xs text-breach" data-testid="approval-reject-reason">Rejected: {approval.reject_reason}</p>
      ) : null}

      {actable && approveAction && rejectAction ? (
        <div className="space-y-3 border-t border-outline-variant pt-4">
          <AuditNote />
          <ApproveForm approvalId={approval.approval_request_id} operationType={approval.operation_type} action={approveAction} />
          <RejectForm approvalId={approval.approval_request_id} action={rejectAction} />
        </div>
      ) : approval.state === 'pending' ? (
        <p className="text-xs text-on-surface-variant border-t border-outline-variant pt-4" data-testid="approval-lockout">
          {isInitiator
            ? 'You initiated this request — a second authorised approver must act (four-eyes).'
            : `Locked — requires the ${approval.approver_required_scope} scope.`}
        </p>
      ) : null}
    </div>
  )
}
