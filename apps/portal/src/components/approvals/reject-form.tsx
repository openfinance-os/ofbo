'use client'

import { useActionState } from 'react'
import { MIN_REJECT_REASON, type ApprovalWriteResult } from '../../lib/approvals'
import { ErrorBanner, SubmitButton, IdempotencyField } from '../ui'

/**
 * UX-06c — reject a gated op via useActionState. On failure the typed BFF error renders in
 * place and the operator's free-text reject reason survives (re-seeded via key+defaultValue,
 * since React 19 resets the form on submit). Success redirects.
 */
type RejectAction = (prev: ApprovalWriteResult, fd: FormData) => Promise<ApprovalWriteResult>

export function RejectForm({ approvalId, action }: { approvalId: string; action: RejectAction }) {
  const [state, formAction] = useActionState<ApprovalWriteResult, FormData>(action, { ok: true })
  return (
    <form action={formAction} data-testid={`reject-form-${approvalId}`} className="space-y-2">
      <IdempotencyField />
      <input type="hidden" name="approval_id" value={approvalId} />
      {state.ok === false && state.error ? (
        <ErrorBanner testid={`reject-error-${approvalId}`} remediation={state.remediation} docsUrl={state.docsUrl}>
          {state.error}
        </ErrorBanner>
      ) : null}
      <textarea
        key={`rr-${state.values?.reject_reason ?? ''}`}
        name="reject_reason"
        aria-label="reject reason"
        required
        minLength={MIN_REJECT_REASON}
        defaultValue={state.values?.reject_reason ?? ''}
        placeholder={`Reject reason (≥ ${MIN_REJECT_REASON} chars)…`}
        className="w-full bg-surface-container-lowest text-xs border border-outline-variant rounded px-2 py-1"
      />
      <SubmitButton pendingLabel="Rejecting…" className="w-full bg-breach text-on-error py-1.5 rounded text-xs font-bold hover:bg-error transition-colors">
        Reject
      </SubmitButton>
    </form>
  )
}
