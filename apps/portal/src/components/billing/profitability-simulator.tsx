'use client'

import { useActionState } from 'react'
import type { BillingWriteResult } from '../../lib/billing-console'
import { formatMilliFils } from '../../lib/billing-console'
import { ErrorBanner, IdempotencyField, SubmitButton } from '../ui'

type SimulationAction = (previous: BillingWriteResult, formData: FormData) => Promise<BillingWriteResult>

function fieldClass(): string {
  return 'mt-1 w-full rounded-lg border border-outline-variant bg-surface-container px-3 py-2 font-mono text-sm text-on-surface outline-none transition-colors focus:border-secondary'
}

export function ProfitabilitySimulator({ period, action }: { period: string; action: SimulationAction }) {
  const [state, formAction] = useActionState<BillingWriteResult, FormData>(action, { ok: true })
  const values = state.values ?? {}
  const result = state.simulation
  const effectiveDefault = `${period}-01`

  return (
    <div className="grid grid-cols-1 gap-6 p-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" data-testid="profitability-simulator">
      <form action={formAction} className="space-y-4">
        <IdempotencyField />
        <input type="hidden" name="period" value={period} />
        {state.ok === false && state.error ? (
          <ErrorBanner testid="simulation-error" remediation={state.remediation} docsUrl={state.docsUrl}>
            {state.error}
          </ErrorBanner>
        ) : null}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="text-xs font-semibold text-on-surface-variant">
            Scenario reference
            <input name="scenario_id" defaultValue={values.scenario_id ?? 'directory-overage'} required maxLength={100} className={fieldClass()} />
          </label>
          <label className="text-xs font-semibold text-on-surface-variant">
            Effective date
            <input name="effective_date" type="date" defaultValue={values.effective_date ?? effectiveDefault} required className={fieldClass()} />
          </label>
          <label className="text-xs font-semibold text-on-surface-variant">
            Receivable multiplier (%)
            <input aria-label="Receivable change" name="receivable_multiplier_percent" type="number" min="0" max="1000" step="0.01" defaultValue={values.receivable_multiplier_percent ?? '100'} required className={fieldClass()} />
          </label>
          <label className="text-xs font-semibold text-on-surface-variant">
            Overage units
            <input name="overage_units" type="number" min="0" step="1" defaultValue={values.overage_units ?? '0'} required className={fieldClass()} />
          </label>
          <label className="text-xs font-semibold text-on-surface-variant">
            Current overage rate (fils)
            <input name="current_rate_fils" type="number" min="0" step="0.001" defaultValue={values.current_rate_fils ?? '0'} required className={fieldClass()} />
          </label>
          <label className="text-xs font-semibold text-on-surface-variant">
            Proposed overage rate (fils)
            <input name="proposed_rate_fils" type="number" min="0" step="0.001" defaultValue={values.proposed_rate_fils ?? '0'} required className={fieldClass()} />
          </label>
        </div>
        <p className="text-xs leading-relaxed text-on-surface-variant">
          Pure what-if calculation over persisted tenant evidence. It does not write billing facts or alter the active rate card.
        </p>
        <SubmitButton pendingLabel="Calculating…" className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-on-primary transition-opacity hover:opacity-90">
          Calculate scenario
        </SubmitButton>
      </form>

      <div className="rounded-xl border border-outline-variant bg-surface-container p-4" aria-live="polite" data-testid="simulation-result">
        <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Scenario impact</p>
        {result ? (
          <div className="mt-4 space-y-4">
            <div>
              <p className="font-mono text-3xl font-bold tabular-nums text-primary">{formatMilliFils(result.delta_profit_milli_fils)}</p>
              <p className="text-xs text-on-surface-variant">Change in monthly profit</p>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <dt className="text-on-surface-variant">Scenario</dt>
                <dd className="mt-1 break-all font-mono text-on-surface">{result.scenario_id}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant">Overage uplift</dt>
                <dd className="mt-1 font-mono text-on-surface">{formatMilliFils(result.overage?.incremental_revenue_milli_fils)}</dd>
              </div>
            </dl>
          </div>
        ) : (
          <p className="mt-4 text-sm text-on-surface-variant">Enter a controlled fee scenario to compare it with the current period.</p>
        )}
      </div>
    </div>
  )
}
