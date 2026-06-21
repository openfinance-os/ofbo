'use client'

import { useActionState } from 'react'
import { type ReconWriteResult } from '../../lib/reconciliation'
import { ErrorBanner, SubmitButton, IdempotencyField } from '../ui'

/** UX-06c — claim a break via useActionState: surfaces the typed BFF error in place on failure
 *  (no inputs to preserve beyond the hidden ids). Success redirects. */
type ClaimAction = (prev: ReconWriteResult, fd: FormData) => Promise<ReconWriteResult>

export function ClaimForm({ breakId, runId, action }: { breakId: string; runId: string; action: ClaimAction }) {
  const [state, formAction] = useActionState<ReconWriteResult, FormData>(action, { ok: true })
  return (
    <form action={formAction} data-testid={`claim-form-${breakId}`} className="mt-3 space-y-2">
      <IdempotencyField />
      <input type="hidden" name="break_id" value={breakId} />
      <input type="hidden" name="run_id" value={runId} />
      {state.ok === false && state.error ? (
        <ErrorBanner testid={`claim-error-${breakId}`} remediation={state.remediation} docsUrl={state.docsUrl}>
          {state.error}
        </ErrorBanner>
      ) : null}
      <SubmitButton pendingLabel="Claiming…" className="w-full bg-secondary text-on-secondary py-1.5 rounded text-xs font-bold hover:bg-secondary-container transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
        Claim break
      </SubmitButton>
    </form>
  )
}
