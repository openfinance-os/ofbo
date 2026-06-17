// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { BreakCard, KpiCards, ReconConsole, RunList } from '../src/components/recon-console.js'
import type { ReconciliationBreak, ReconciliationRun } from '../src/lib/reconciliation.js'

afterEach(cleanup)

/**
 * UI-03 — Reconciliation Console (presentational). Asserts KPI derivation, run-list
 * selection, break-queue status tones + money formatting, and that claim/resolve are
 * offered only when the principal canWrite and the break is in the right state.
 */

const run: ReconciliationRun = {
  id: 'r1',
  run_id: 'RUN-2026-06-17',
  run_type: 'daily',
  status: 'completed',
  reconciliation_window_start: '2026-06-16T00:00:00Z',
  reconciliation_window_end: '2026-06-17T00:00:00Z',
  line_count_total: 1000,
  line_count_matched: 991,
  line_count_unmatched: 6,
  line_count_disputed: 3,
  failure_reason: null,
  created_at: '2026-06-17T03:00:00Z'
}

const flaggedBreak: ReconciliationBreak = {
  id: 'b-flagged',
  run_id: run.run_id,
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
const assignedBreak: ReconciliationBreak = { ...flaggedBreak, id: 'b-assigned', status: 'assigned', assigned_to: 'demo:finance', sla_clock_started_at: '2026-06-17T04:00:00Z' }

describe('KpiCards', () => {
  it('derives the matched success rate from the run line counts', () => {
    render(<KpiCards run={run} />)
    expect(screen.getByTestId('kpi-matched')).toHaveTextContent('991')
    expect(screen.getByTestId('kpi-matched')).toHaveTextContent('99.1% success rate')
    expect(screen.getByTestId('kpi-unmatched')).toHaveTextContent('Action required')
  })
})

describe('RunList', () => {
  it('lists runs and marks the selected one', () => {
    render(<RunList runs={[run]} selectedId={run.run_id} />)
    const row = screen.getByTestId('run-RUN-2026-06-17')
    expect(row).toHaveTextContent('RUN-2026-06-17')
    expect(within(row).getByRole('link')).toHaveAttribute('aria-current', 'true')
  })
})

describe('BreakCard', () => {
  const noop = () => {}

  it('formats the variance as money and shows claim ONLY for a flagged break with write scope', () => {
    render(<BreakCard b={flaggedBreak} canWrite claimAction={noop} resolveAction={noop} />)
    expect(screen.getByTestId('variance-b-flagged')).toHaveTextContent('AED 1,450.00')
    expect(screen.getByTestId('claim-form-b-flagged')).toBeInTheDocument()
    expect(screen.queryByTestId('resolve-form-b-flagged')).not.toBeInTheDocument()
  })

  it('shows resolve (with outcome options) for an assigned break, not claim', () => {
    render(<BreakCard b={assignedBreak} canWrite claimAction={noop} resolveAction={noop} />)
    const form = screen.getByTestId('resolve-form-b-assigned')
    expect(form).toBeInTheDocument()
    expect(within(form).getByRole('option', { name: 'resolved_matched' })).toBeInTheDocument()
    expect(screen.queryByTestId('claim-form-b-assigned')).not.toBeInTheDocument()
  })

  it('offers NO mutation affordance to a read-only (no write scope) principal', () => {
    render(<BreakCard b={flaggedBreak} canWrite={false} claimAction={noop} resolveAction={noop} />)
    expect(screen.queryByTestId('claim-form-b-flagged')).not.toBeInTheDocument()
    expect(screen.queryByTestId('resolve-form-b-flagged')).not.toBeInTheDocument()
  })
})

describe('ReconConsole', () => {
  const noop = () => {}

  it('renders KPIs for the selected run, the run list, and the break queue', () => {
    render(<ReconConsole runs={[run]} selectedRun={run} breaks={[flaggedBreak]} canWrite claimAction={noop} resolveAction={noop} />)
    expect(screen.getByTestId('kpi-cards')).toBeInTheDocument()
    expect(screen.getByTestId('run-list')).toBeInTheDocument()
    expect(screen.getByTestId('break-queue')).toHaveTextContent('Break Queue')
    expect(screen.getByTestId("break-b-flagged")).toBeInTheDocument()
  })

  it('shows notice/error banners and the empty break-queue state', () => {
    const { rerender } = render(<ReconConsole runs={[run]} selectedRun={run} breaks={[]} notice="Break claimed — SLA clock started." />)
    expect(screen.getByTestId('recon-notice')).toHaveTextContent('SLA clock started')
    expect(screen.getByTestId('breaks-empty')).toBeInTheDocument()
    rerender(<ReconConsole runs={[]} breaks={[]} error="Failed to load reconciliation data." />)
    expect(screen.getByTestId('recon-error')).toHaveTextContent('Failed to load')
    expect(screen.getByTestId('runs-empty')).toBeInTheDocument()
  })
})
