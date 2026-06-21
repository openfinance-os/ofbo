'use client'

import { useActionState } from 'react'
import { REVOKE_REASON_CODES, type CareConsent, type CareWriteResult } from '../../lib/care'
import { ErrorBanner, ConfirmSubmit, IdempotencyField } from '../ui'

/**
 * UX-06b — the consent-revoke form as a useActionState island. On a BFF failure the action
 * returns a CareWriteResult instead of redirecting: the typed error + remediation render in
 * place (UX-06) and the chosen reason survives (re-seeded via defaultValue, since React 19
 * resets the form on submit). The two-step ConfirmSubmit is unchanged — it just submits the
 * enclosing form, which now dispatches the useActionState action. Success redirects.
 */
type RevokeAction = (prev: CareWriteResult, fd: FormData) => Promise<CareWriteResult>

export function RevokeForm({
  consent,
  psu,
  identifierType,
  action
}: {
  consent: CareConsent
  psu: string
  identifierType: string
  action: RevokeAction
}) {
  const [state, formAction] = useActionState<CareWriteResult, FormData>(action, { ok: true })
  return (
    <form action={formAction} data-testid={`revoke-form-${consent.consent_id}`} className="flex flex-col items-end gap-1">
      <IdempotencyField />
      <input type="hidden" name="consent_id" value={consent.consent_id} />
      <input type="hidden" name="identifier_type" value={identifierType} />
      <input type="hidden" name="identifier" value={psu} />
      {state.ok === false && state.error ? (
        <ErrorBanner testid={`revoke-error-${consent.consent_id}`} remediation={state.remediation} docsUrl={state.docsUrl}>
          {state.error}
        </ErrorBanner>
      ) : null}
      <div className="flex items-center gap-1">
        <select
          key={`rc-${state.values?.reason_code ?? ''}`}
          name="reason_code"
          aria-label="revoke reason"
          defaultValue={state.values?.reason_code ?? ''}
          required
          className="bg-surface-container text-xs border border-outline-variant rounded px-1 py-1"
        >
          <option value="" disabled>
            Reason…
          </option>
          {REVOKE_REASON_CODES.map((r) => (
            <option key={r} value={r}>
              {r.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <ConfirmSubmit
          label="Revoke"
          confirmLabel="Confirm revoke"
          summary={`Revoke ${consent.tpp.display_name}'s consent. This propagates to Nebras (≤5s) and cannot be undone.`}
          className="bg-breach text-on-error px-3 py-1 rounded text-xs font-bold hover:bg-error transition-colors"
          testid={`revoke-submit-${consent.consent_id}`}
        />
      </div>
    </form>
  )
}
