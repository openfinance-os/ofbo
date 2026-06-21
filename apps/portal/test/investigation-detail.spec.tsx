// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { InvestigationDetail, ThreeSourceDiff } from '../src/components/investigation-detail.js'
import type { ReconciliationBreak } from '../src/lib/reconciliation.js'

afterEach(cleanup)

/**
 * UI-04 — Investigation Detail (presentational). Asserts the three-source side-by-side
 * diff (A/B/C) renders with the missing-source highlight, and that the Nebras escalation
 * is offered only for an escalatable break with finance:disputes:write and not yet escalated.
 */

const base: ReconciliationBreak = {
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
  source_c_ref: null,
  assigned_to: null,
  sla_clock_started_at: null,
  resolution_outcome: null,
  resolution_note: null,
  nebras_dispute_case_id: null,
  reopened_count: 0,
  created_at: '2026-06-17T03:01:00Z'
}

describe('ThreeSourceDiff', () => {
  it('renders all three sources and marks the missing one', () => {
    render(<ThreeSourceDiff break_={base} />)
    expect(screen.getByTestId('source-A')).toHaveTextContent('NB-1')
    expect(screen.getByTestId('source-B')).toHaveTextContent('PL-1')
    expect(screen.getByTestId('source-C')).toHaveTextContent('MISSING')
  })
})

describe('InvestigationDetail', () => {
  const noop = () => {}

  it('UX-09: shows a breadcrumb (Reconciliation / Break …) for wayfinding on the deep-linked detail', () => {
    render(<InvestigationDetail break_={base} />)
    const crumb = screen.getByTestId('breadcrumb')
    expect(crumb).toHaveAttribute('aria-label', 'breadcrumb')
    expect(screen.getByTestId('back-link')).toHaveAttribute('href', '/reconciliation')
    expect(crumb).toHaveTextContent('Break tpp-acme')
  })

  it('shows the variance, three-source diff, and the escalate action for a flagged break with dispute scope', () => {
    render(<InvestigationDetail break_={base} canDispute escalateAction={noop} />)
    expect(screen.getByTestId('break-summary')).toHaveTextContent('AED 1,450.00')
    expect(screen.getByTestId('three-source-diff')).toBeInTheDocument()
    expect(screen.getByTestId('escalate-form')).toBeInTheDocument()
  })

  it('hides escalate for a read-only principal (no dispute scope)', () => {
    render(<InvestigationDetail break_={base} canDispute={false} escalateAction={noop} />)
    expect(screen.queryByTestId('escalate-form')).not.toBeInTheDocument()
  })

  it('hides escalate and shows the case id once already escalated', () => {
    render(<InvestigationDetail break_={{ ...base, status: 'escalated_nebras_dispute', nebras_dispute_case_id: 'NBR-9' }} canDispute escalateAction={noop} />)
    expect(screen.queryByTestId('escalate-form')).not.toBeInTheDocument()
    expect(screen.getByTestId('nebras-case')).toHaveTextContent('NBR-9')
  })

  it('hides escalate for a terminal (resolved) break even with scope', () => {
    render(<InvestigationDetail break_={{ ...base, status: 'resolved_matched' }} canDispute escalateAction={noop} />)
    expect(screen.queryByTestId('escalate-form')).not.toBeInTheDocument()
  })
})
