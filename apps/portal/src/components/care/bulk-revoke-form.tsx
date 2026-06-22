'use client'

import { useActionState } from 'react'
import { type CareWriteResult } from '../../lib/care'
import { ErrorBanner, ConfirmSubmit, IdempotencyField } from '../ui'

/**
 * UIF-09b(a) / BACKOFFICE-18 — emergency PSU-wide bulk revocation: revoke ALL of the
 * looked-up PSU's active consents in one action (reason: client instruction). Four-eyes —
 * the BFF returns 202 + an approval_request; a DIFFERENT consents-admin approver completes
 * it in /approvals, never inline. Two-step ConfirmSubmit guards the destructive trigger;
 * the PSU identifier travels server-side via hidden inputs (not re-typed in the browser).
 * Surfaces the typed BFF error in place on failure; success redirects with a notice.
 */
type BulkRevokeAction = (prev: CareWriteResult, fd: FormData) => Promise<CareWriteResult>

export function BulkRevokeForm({
  psu,
  identifierType,
  consentCount,
  action
}: {
  psu: string
  identifierType: string
  consentCount: number
  action: BulkRevokeAction
}) {
  const [state, formAction] = useActionState<CareWriteResult, FormData>(action, { ok: true })
  return (
    <form action={formAction} data-testid="bulk-revoke-form" className="space-y-2">
      <IdempotencyField />
      <input type="hidden" name="identifier_type" value={identifierType} />
      <input type="hidden" name="identifier" value={psu} />
      {state.ok === false && state.error ? (
        <ErrorBanner testid="bulk-revoke-error" remediation={state.remediation} docsUrl={state.docsUrl}>
          {state.error}
        </ErrorBanner>
      ) : null}
      <ConfirmSubmit
        label="Emergency bulk-revoke"
        confirmLabel="Confirm bulk-revoke"
        summary={`Revoke ALL ${consentCount} active consent${consentCount === 1 ? '' : 's'} for this PSU (reason: client instruction). Submitted for four-eyes approval — a second consents-admin approver completes it; on approval it propagates to Nebras (≤5s) and cannot be undone.`}
        className="w-full bg-breach text-on-error px-3 py-1.5 rounded text-xs font-bold hover:bg-error transition-colors"
        testid="bulk-revoke-submit"
      />
      <p className="text-xs text-on-surface-variant">
        Four-eyes: submitted for approval — a different consents-admin approver completes it in{' '}
        <a href="/approvals" className="text-secondary hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          Approvals
        </a>
        . Never revoked inline.
      </p>
    </form>
  )
}
