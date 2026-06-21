'use client'

import { useActionState } from 'react'
import { type TppWriteResult } from '../../lib/tpp-billing'
import { ErrorBanner, SubmitButton, IdempotencyField } from '../ui'

/** UX-06d — register a TPP's P9 financial system via useActionState: surfaces the typed BFF
 *  error in place on failure (organisation_id is fixed per row). Success redirects. */
type RegisterAction = (prev: TppWriteResult, fd: FormData) => Promise<TppWriteResult>

export function RegisterForm({ organisationId, action }: { organisationId: string; action: RegisterAction }) {
  const [state, formAction] = useActionState<TppWriteResult, FormData>(action, { ok: true })
  return (
    <form action={formAction} data-testid={`register-form-${organisationId}`} className="space-y-1">
      <IdempotencyField />
      <input type="hidden" name="organisation_id" value={organisationId} />
      {state.ok === false && state.error ? (
        <ErrorBanner testid={`register-error-${organisationId}`} remediation={state.remediation} docsUrl={state.docsUrl}>
          {state.error}
        </ErrorBanner>
      ) : null}
      <SubmitButton pendingLabel="Registering…" className="bg-secondary text-on-secondary px-3 py-1 rounded text-xs font-bold hover:bg-secondary-container transition-colors">
        Register P9
      </SubmitButton>
    </form>
  )
}
