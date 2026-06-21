'use client'

import { useActionState } from 'react'
import { DISPUTE_TYPES, type CareWriteResult } from '../../lib/care'
import { ErrorBanner, SubmitButton, IdempotencyField } from '../ui'

/**
 * UX-06b — the dispute form as a useActionState island. On a BFF failure the action returns a
 * CareWriteResult instead of redirecting, so (a) the real typed error + remediation render in
 * place via ErrorBanner (UX-06) and (b) the operator's entered values survive (React 19 resets
 * the form on submit, so we re-seed them from state.values via defaultValue). Success redirects.
 */
type DisputeAction = (prev: CareWriteResult, fd: FormData) => Promise<CareWriteResult>

export function DisputeForm({ psu, identifierType, action }: { psu: string; identifierType: string; action: DisputeAction }) {
  const [state, formAction] = useActionState<CareWriteResult, FormData>(action, { ok: true })
  const v = state.values ?? {}
  return (
    <form action={formAction} className="space-y-2" data-testid="dispute-form">
      <IdempotencyField />
      <input type="hidden" name="identifier_type" value={identifierType} />
      <input type="hidden" name="identifier" value={psu} />
      {state.ok === false && state.error ? (
        <ErrorBanner testid="dispute-error" remediation={state.remediation} docsUrl={state.docsUrl}>
          {state.error}
        </ErrorBanner>
      ) : null}
      <label className="block">
        <span className="block text-xs font-bold text-on-surface-variant uppercase">Originating payment id</span>
        <input
          key={`pid-${v.originating_payment_id ?? ''}`}
          name="originating_payment_id"
          defaultValue={v.originating_payment_id ?? ''}
          placeholder="PIS-…"
          className="w-full bg-surface-container text-xs font-mono border border-outline-variant rounded px-2 py-1"
        />
      </label>
      <select
        key={`dt-${v.dispute_type ?? ''}`}
        name="dispute_type"
        aria-label="dispute type"
        defaultValue={v.dispute_type ?? DISPUTE_TYPES[0]}
        className="w-full bg-surface-container text-xs border border-outline-variant rounded px-2 py-1"
      >
        {DISPUTE_TYPES.map((t) => (
          <option key={t} value={t}>
            {t.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
      <SubmitButton pendingLabel="Opening…" className="w-full bg-breach text-on-error py-2 rounded font-bold text-xs hover:bg-error transition-colors">
        Open dispute
      </SubmitButton>
    </form>
  )
}
