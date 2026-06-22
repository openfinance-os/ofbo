'use client'

import { useActionState } from 'react'
import { type ReconWriteResult } from '../../lib/reconciliation'
import { ErrorBanner, SubmitButton, IdempotencyField } from '../ui'

/**
 * UIF-07b(c) / BACKOFFICE-06 — request the four-eyes monthly reconciliation sign-off.
 * Locking + signing the month is submitted for approval (202); a DIFFERENT finance
 * principal completes it in /approvals — never inline. Surfaces the typed BFF error in
 * place on failure (keeps the period); success redirects with a notice. Token-only.
 */
type SignoffAction = (prev: ReconWriteResult, fd: FormData) => Promise<ReconWriteResult>

export function SignoffForm({ defaultPeriod, action }: { defaultPeriod: string; action: SignoffAction }) {
  const [state, formAction] = useActionState<ReconWriteResult, FormData>(action, { ok: true })
  return (
    <form action={formAction} data-testid="signoff-form" className="space-y-2">
      <IdempotencyField />
      <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider">
        Period
        <input
          name="period"
          defaultValue={state.values?.period ?? defaultPeriod}
          pattern="\d{4}-\d{2}"
          placeholder="YYYY-MM"
          aria-describedby="signoff-foureyes-note"
          className="mt-1 block w-full bg-surface-container text-sm font-mono border border-outline-variant rounded-lg px-3 py-2 focus:border-secondary focus:ring-secondary"
        />
      </label>
      {state.ok === false && state.error ? (
        <ErrorBanner testid="signoff-error" remediation={state.remediation} docsUrl={state.docsUrl}>
          {state.error}
        </ErrorBanner>
      ) : null}
      <SubmitButton pendingLabel="Submitting…" className="w-full bg-secondary text-on-secondary py-2 rounded-lg text-xs font-bold hover:bg-secondary-container transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
        Request monthly sign-off
      </SubmitButton>
      <p id="signoff-foureyes-note" className="text-xs text-on-surface-variant">
        Four-eyes: locking the month is submitted for approval — a different finance approver completes it in{' '}
        <a href="/approvals" className="text-secondary hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          Approvals
        </a>
        . Never signed off inline.
      </p>
    </form>
  )
}
