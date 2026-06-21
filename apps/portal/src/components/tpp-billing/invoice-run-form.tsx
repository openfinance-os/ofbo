'use client'

import { useActionState } from 'react'
import { type TppWriteResult } from '../../lib/tpp-billing'
import { ErrorBanner, SubmitButton, IdempotencyField } from '../ui'

/**
 * UX-06d — the four-eyes invoice-run initiator form as a useActionState island. On failure the
 * typed BFF error renders in place and the entered billing period + record-set id survive
 * (re-seeded via key+defaultValue). Success redirects with ?ar=<approval id> so the initiator
 * can track the four-eyes request (UX-03).
 */
type InvoiceAction = (prev: TppWriteResult, fd: FormData) => Promise<TppWriteResult>

export function InvoiceRunForm({ action }: { action: InvoiceAction }) {
  const [state, formAction] = useActionState<TppWriteResult, FormData>(action, { ok: true })
  const v = state.values ?? {}
  return (
    <form action={formAction} data-testid="invoice-run-form" className="space-y-2">
      <IdempotencyField />
      {state.ok === false && state.error ? (
        <ErrorBanner testid="invoice-error" remediation={state.remediation} docsUrl={state.docsUrl}>
          {state.error}
        </ErrorBanner>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="block text-on-surface-variant mb-1">Billing period</span>
          <input
            key={`bp-${v.billing_period ?? ''}`}
            name="billing_period"
            defaultValue={v.billing_period ?? ''}
            placeholder="2026-06"
            className="bg-surface-container text-xs border border-outline-variant rounded px-2 py-1"
          />
        </label>
        <label className="text-xs">
          <span className="block text-on-surface-variant mb-1">Record set id</span>
          <input
            key={`rs-${v.record_set_id ?? ''}`}
            name="record_set_id"
            defaultValue={v.record_set_id ?? ''}
            placeholder="rec-…"
            className="bg-surface-container text-xs font-mono border border-outline-variant rounded px-2 py-1"
          />
        </label>
        <SubmitButton pendingLabel="Submitting…" className="bg-primary-container text-on-primary-container px-3 py-1.5 rounded text-xs font-bold hover:opacity-90 transition-opacity">
          Run monthly invoicing
        </SubmitButton>
      </div>
    </form>
  )
}
