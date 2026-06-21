'use client'

import { useActionState } from 'react'
import { type ApprovalWriteResult } from '../../lib/approvals'
import { ErrorBanner, ConfirmSubmit, IdempotencyField } from '../ui'

/** UX-06c — approve a gated op via useActionState: surfaces the typed BFF error in place on
 *  failure (the four-eyes execution stays server-side at the BFF). Success redirects. */
type ApproveAction = (prev: ApprovalWriteResult, fd: FormData) => Promise<ApprovalWriteResult>

export function ApproveForm({ approvalId, operationType, action }: { approvalId: string; operationType: string; action: ApproveAction }) {
  const [state, formAction] = useActionState<ApprovalWriteResult, FormData>(action, { ok: true })
  return (
    <form action={formAction} data-testid={`approve-form-${approvalId}`} className="space-y-2">
      <IdempotencyField />
      <input type="hidden" name="approval_id" value={approvalId} />
      {state.ok === false && state.error ? (
        <ErrorBanner testid={`approve-error-${approvalId}`} remediation={state.remediation} docsUrl={state.docsUrl}>
          {state.error}
        </ErrorBanner>
      ) : null}
      <ConfirmSubmit
        label="Approve"
        confirmLabel="Confirm approval"
        summary={`Approve ${operationType}. As the second authorised principal, confirming makes the BFF execute this gated operation now.`}
        className="w-full bg-reconciled text-on-error py-1.5 rounded text-xs font-bold hover:opacity-90 transition-opacity"
        testid={`approve-submit-${approvalId}`}
      />
    </form>
  )
}
