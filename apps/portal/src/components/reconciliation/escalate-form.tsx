'use client'

import { useActionState } from 'react'
import { formatMoney, type ReconciliationBreak, type ReconWriteResult } from '../../lib/reconciliation'
import { ErrorBanner, ConfirmSubmit, AuditNote } from '../ui'

/**
 * UX-06d — escalate-to-Nebras as a useActionState island. On failure the typed BFF error
 * renders in place (no inputs to preserve — it's a single confirmed action); success
 * redirects. The two-step ConfirmSubmit is unchanged. Reuses ReconWriteResult.
 */
type EscalateAction = (prev: ReconWriteResult, fd: FormData) => Promise<ReconWriteResult>

export function EscalateForm({ break_, action }: { break_: ReconciliationBreak; action: EscalateAction }) {
  const [state, formAction] = useActionState<ReconWriteResult, FormData>(action, { ok: true })
  return (
    <form action={formAction} className="mt-3" data-testid="escalate-form">
      <input type="hidden" name="break_id" value={break_.id} />
      {state.ok === false && state.error ? (
        <ErrorBanner testid="escalate-error" remediation={state.remediation} docsUrl={state.docsUrl}>
          {state.error}
        </ErrorBanner>
      ) : null}
      <ConfirmSubmit
        label="Escalate to Nebras"
        confirmLabel="Confirm escalation"
        summary={`Raise a Nebras dispute for break ${break_.client_id}${break_.variance_amount ? ` (${formatMoney(break_.variance_amount)})` : ''}. This creates an external case via the egress gateway and cannot be undone.`}
        className="bg-breach text-on-error px-4 py-2 rounded-lg text-xs font-bold hover:bg-error transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        testid="escalate-submit"
      />
      <AuditNote className="mt-2" />
    </form>
  )
}
