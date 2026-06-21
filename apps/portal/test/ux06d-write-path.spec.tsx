// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { EscalateForm } from '../src/components/reconciliation/escalate-form.js'
import { InvoiceRunForm } from '../src/components/tpp-billing/invoice-run-form.js'
import type { ReconciliationBreak, ReconWriteResult } from '../src/lib/reconciliation.js'
import type { TppWriteResult } from '../src/lib/tpp-billing.js'

afterEach(cleanup)

/**
 * UX-06d — investigation escalate + tpp invoice-run return a typed result on failure (no
 * redirect), so the form surfaces the real BFF error in place and keeps free-text inputs.
 */
const brk: ReconciliationBreak = {
  id: 'b-1',
  run_id: 'RUN-1',
  client_id: 'tpp-acme',
  channel: 'pis',
  line_type: 'fee',
  status: 'flagged',
  variance_amount: { amount: 145000, currency: 'AED' },
  variance_count: null,
  source_a_ref: 'NB-1',
  source_b_ref: 'PL-1',
  source_c_ref: 'FT-1',
  assigned_to: null,
  sla_clock_started_at: null,
  resolution_outcome: null,
  resolution_note: null,
  nebras_dispute_case_id: null,
  reopened_count: 0,
  created_at: '2026-06-17T03:01:00Z'
}

describe('EscalateForm (useActionState)', () => {
  it('surfaces the typed BFF error in place on failure', async () => {
    const action = async (): Promise<ReconWriteResult> => ({
      ok: false,
      error: 'Nebras case management is unavailable.',
      remediation: 'Retry in a few minutes.'
    })
    render(<EscalateForm break_={brk} action={action} />)
    fireEvent.submit(screen.getByTestId('escalate-form'))
    expect(await screen.findByTestId('escalate-error')).toHaveTextContent('Nebras case management is unavailable.')
    expect(screen.getByTestId('escalate-error-remediation')).toHaveTextContent('Retry in a few minutes.')
  })
})

describe('InvoiceRunForm (useActionState)', () => {
  it('surfaces the typed error + preserves the billing period and record set on failure', async () => {
    const action = async (): Promise<TppWriteResult> => ({
      ok: false,
      error: 'Record set not found.',
      values: { billing_period: '2026-06', record_set_id: 'rec-42' }
    })
    render(<InvoiceRunForm action={action} />)
    fireEvent.submit(screen.getByTestId('invoice-run-form'))
    expect(await screen.findByTestId('invoice-error')).toHaveTextContent('Record set not found.')
    expect(screen.getByDisplayValue('2026-06')).toBeInTheDocument()
    expect(screen.getByDisplayValue('rec-42')).toBeInTheDocument()
  })
})
