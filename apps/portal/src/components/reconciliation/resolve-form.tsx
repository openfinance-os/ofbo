'use client'

import { useActionState } from 'react'
import { RESOLVE_OUTCOMES, MIN_RESOLUTION_NOTE, type ReconWriteResult } from '../../lib/reconciliation'
import { ErrorBanner, SubmitButton, IdempotencyField } from '../ui'

/**
 * UX-06c — resolve a break via useActionState. On failure the action returns the typed error
 * (rendered in place) and the operator's chosen outcome + free-text note survive (re-seeded via
 * key+defaultValue, since React 19 resets the form on submit). Success redirects.
 */
type ResolveAction = (prev: ReconWriteResult, fd: FormData) => Promise<ReconWriteResult>

export function ResolveForm({ breakId, runId, action }: { breakId: string; runId: string; action: ResolveAction }) {
  const [state, formAction] = useActionState<ReconWriteResult, FormData>(action, { ok: true })
  const v = state.values ?? {}
  return (
    <form action={formAction} data-testid={`resolve-form-${breakId}`} className="mt-3 space-y-2 border-t border-outline-variant pt-3">
      <IdempotencyField />
      <input type="hidden" name="break_id" value={breakId} />
      <input type="hidden" name="run_id" value={runId} />
      {state.ok === false && state.error ? (
        <ErrorBanner testid={`resolve-error-${breakId}`} remediation={state.remediation} docsUrl={state.docsUrl}>
          {state.error}
        </ErrorBanner>
      ) : null}
      <select
        key={`ro-${v.resolution_outcome ?? ''}`}
        name="resolution_outcome"
        aria-label="resolution outcome"
        defaultValue={v.resolution_outcome ?? ''}
        required
        className="w-full bg-surface-container text-xs border border-outline-variant rounded px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <option value="" disabled>
          Select outcome…
        </option>
        {RESOLVE_OUTCOMES.map((o) => (
          <option key={o} value={o}>
            {o.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
      <textarea
        key={`rn-${v.resolution_note ?? ''}`}
        name="resolution_note"
        aria-label="resolution note"
        minLength={MIN_RESOLUTION_NOTE}
        required
        defaultValue={v.resolution_note ?? ''}
        placeholder={`Resolution note (≥ ${MIN_RESOLUTION_NOTE} chars)…`}
        className="w-full bg-surface-container-lowest text-xs border border-outline-variant rounded px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
      <SubmitButton pendingLabel="Resolving…" className="w-full bg-reconciled text-on-error py-1.5 rounded text-xs font-bold hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
        Resolve break
      </SubmitButton>
    </form>
  )
}
