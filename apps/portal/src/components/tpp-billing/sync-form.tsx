'use client'

import { useActionState } from 'react'
import { type TppWriteResult } from '../../lib/tpp-billing'
import { ErrorBanner, SubmitButton, IdempotencyField } from '../ui'

/** UX-06d — sync the TPP directory via useActionState: surfaces the typed BFF error in place
 *  on failure (no inputs). Success redirects. */
type SyncAction = (prev: TppWriteResult, fd: FormData) => Promise<TppWriteResult>

export function SyncForm({ action }: { action: SyncAction }) {
  const [state, formAction] = useActionState<TppWriteResult, FormData>(action, { ok: true })
  return (
    <form action={formAction} data-testid="sync-form" className="space-y-1">
      <IdempotencyField />
      {state.ok === false && state.error ? (
        <ErrorBanner testid="sync-error" remediation={state.remediation} docsUrl={state.docsUrl}>
          {state.error}
        </ErrorBanner>
      ) : null}
      <SubmitButton pendingLabel="Syncing…" className="border border-outline-variant text-on-surface-variant px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-surface-container-low transition-colors">
        Sync directory
      </SubmitButton>
    </form>
  )
}
