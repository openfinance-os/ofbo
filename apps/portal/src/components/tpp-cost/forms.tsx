'use client'

import { useActionState } from 'react'
import type { TppCostWriteResult } from '../../lib/tpp-cost-actions'
import { ErrorBanner, SubmitButton, IdempotencyField } from '../ui'

/**
 * BILL-17 — the two payable write paths, as `useActionState` islands.
 *
 * Both surface the typed BFF error IN PLACE rather than redirecting, which matters more here than
 * on most forms: the refusals these two produce are the controls themselves speaking (an unresolved
 * break blocking a close, an approval that does not authorise this caller), and a redirect would
 * replace a specific, actionable message with a page that silently did nothing.
 */

type CostAction = (prev: TppCostWriteResult, fd: FormData) => Promise<TppCostWriteResult>

/** Four-eyes. This asks; a SECOND finance principal approves, and only then does the period close. */
export function RequestCloseForm({ period, action, disabled, disabledReason }: {
  period: string
  action: CostAction
  disabled: boolean
  disabledReason: string
}) {
  const [state, formAction] = useActionState<TppCostWriteResult, FormData>(action, { ok: true })
  return (
    <form action={formAction} data-testid="request-close-form" className="space-y-2">
      <IdempotencyField />
      <input type="hidden" name="period" value={period} />
      {state.ok === false && state.error ? (
        <ErrorBanner testid="request-close-error" remediation={state.remediation} docsUrl={state.docsUrl}>
          {state.error}
        </ErrorBanner>
      ) : null}
      {disabled ? (
        <p data-testid="close-disabled-reason" className="text-xs text-on-surface-variant">{disabledReason}</p>
      ) : null}
      <SubmitButton
        disabled={disabled}
        pendingLabel="Requesting…"
        className="bg-primary text-on-primary px-3 py-1 rounded text-xs font-bold hover:bg-primary-container transition-colors disabled:opacity-50"
      >
        Request period close
      </SubmitButton>
    </form>
  )
}

/** Authorises HONOURING a scheme direct debit — not a push payment (IG v5.0 §10.14–10.15). */
export function DispatchPayableForm({ payableId, action, disabled, disabledReason }: {
  payableId: string
  action: CostAction
  disabled: boolean
  disabledReason: string
}) {
  const [state, formAction] = useActionState<TppCostWriteResult, FormData>(action, { ok: true })
  return (
    <form action={formAction} data-testid={`dispatch-form-${payableId}`} className="space-y-1">
      <IdempotencyField />
      <input type="hidden" name="payable_id" value={payableId} />
      {state.ok === false && state.error ? (
        <ErrorBanner testid={`dispatch-error-${payableId}`} remediation={state.remediation} docsUrl={state.docsUrl}>
          {state.error}
        </ErrorBanner>
      ) : null}
      <SubmitButton
        disabled={disabled}
        pendingLabel="Dispatching…"
        title={disabled ? disabledReason : undefined}
        className="bg-secondary text-on-secondary px-3 py-1 rounded text-xs font-bold hover:bg-secondary-container transition-colors disabled:opacity-50"
      >
        Dispatch to P9
      </SubmitButton>
    </form>
  )
}
