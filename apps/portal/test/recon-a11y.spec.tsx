// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ReconConsole, BreakQueue, RunList } from '../src/components/recon-console.js'
import { InvestigationDetail } from '../src/components/investigation-detail.js'
import type { ReconciliationBreak, ReconciliationRun } from '../src/lib/reconciliation.js'

afterEach(cleanup)

/**
 * BACKOFFICE-15 — Reconciliation console accessibility (WCAG 2.1 AA): keyboard-only
 * and screen-reader traversal of the break list and detail views. These assert the
 * concrete success criteria: 1.3.1 Info & Relationships (landmark regions, label↔value),
 * 4.1.2 Name/Role/Value (every control has an accessible name), 4.1.3 Status Messages
 * (banners announced), 2.1.1 Keyboard (native, focusable controls), 2.4.7 Focus Visible.
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
const noop = () => {}

describe('Reconciliation console — screen-reader traversal (1.3.1, 4.1.3)', () => {
  it('exposes the run list and break queue as named landmark regions', () => {
    render(<ReconConsole runs={[run]} selectedRun={run} breaks={[flaggedBreak]} canWrite claimAction={noop} resolveAction={noop} />)
    expect(screen.getByRole('region', { name: /reconciliation runs/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /break queue/i })).toBeInTheDocument()
  })

  it('gives the break-queue count an accessible, non-color-only meaning', () => {
    render(<BreakQueue breaks={[flaggedBreak, assignedBreak]} />)
    // a screen reader must hear "2 open breaks", not a bare "2"
    expect(screen.getByText(/2 open breaks/i)).toBeInTheDocument()
  })

  it('announces the error banner as an alert and the notice as a status', () => {
    const { rerender } = render(<ReconConsole runs={[run]} selectedRun={run} breaks={[]} notice="Break claimed — SLA clock started." />)
    expect(screen.getByRole('status')).toHaveTextContent(/SLA clock started/)
    rerender(<ReconConsole runs={[]} breaks={[]} error="Failed to load reconciliation data." />)
    expect(screen.getByRole('alert')).toHaveTextContent(/Failed to load/)
  })
})

describe('Reconciliation console — keyboard operability (2.1.1, 2.4.7, 4.1.2)', () => {
  it('every break action is a focusable native control with an accessible name', () => {
    render(<ReconConsole runs={[run]} selectedRun={run} breaks={[flaggedBreak]} canWrite claimAction={noop} resolveAction={noop} />)
    const claim = screen.getByRole('button', { name: /claim break/i })
    claim.focus()
    expect(claim).toHaveFocus()
    expect(claim.className).toMatch(/focus-visible:/) // 2.4.7 visible focus indicator
  })

  it('disambiguates the per-break Investigate link by client (4.1.2)', () => {
    render(<BreakQueue breaks={[flaggedBreak]} />)
    expect(screen.getByRole('link', { name: /investigate .*tpp-acme/i })).toBeInTheDocument()
  })

  it('selected run link is focusable and marked current', () => {
    render(<RunList runs={[run]} selectedId={run.run_id} />)
    const link = within(screen.getByTestId('run-RUN-2026-06-17')).getByRole('link')
    link.focus()
    expect(link).toHaveFocus()
    expect(link).toHaveAttribute('aria-current', 'true')
  })
})

describe('Investigation detail — screen-reader traversal + keyboard (1.3.1, 4.1.2, 4.1.3, 2.4.7)', () => {
  it('exposes the three-way comparison as a named region with per-source labels', () => {
    render(<InvestigationDetail break_={flaggedBreak} />)
    const diff = screen.getByRole('region', { name: /three-way comparison/i })
    expect(within(diff).getByText(/Nebras Billing/i)).toBeInTheDocument()
    expect(within(diff).getByText(/Bank Platform/i)).toBeInTheDocument()
    expect(within(diff).getByText(/Fintech Billing/i)).toBeInTheDocument()
  })

  it('announces error/notice banners and keeps escalation a focusable named control', () => {
    const { rerender } = render(<InvestigationDetail break_={flaggedBreak} canDispute escalateAction={noop} notice="Escalated to Nebras." />)
    expect(screen.getByRole('status')).toHaveTextContent(/Escalated to Nebras/)
    rerender(<InvestigationDetail break_={flaggedBreak} canDispute escalateAction={noop} error="Escalation failed." />)
    expect(screen.getByRole('alert')).toHaveTextContent(/Escalation failed/)
    const btn = screen.getByRole('button', { name: /escalate to nebras/i })
    btn.focus()
    expect(btn).toHaveFocus()
    expect(btn.className).toMatch(/focus-visible:/)
  })
})
