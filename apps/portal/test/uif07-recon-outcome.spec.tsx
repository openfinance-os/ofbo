// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { axe } from 'vitest-axe'
import type { ReactElement } from 'react'

import { ReconOutcomePanel } from '../src/components/recon-outcome.js'
import type { ReconciliationRun } from '../src/lib/reconciliation.js'

afterEach(cleanup)

/**
 * UIF-07 — the Reconciliation Outcome panel (ADR 0016): the UIF-01b Gauge (run pass rate) +
 * the UIF-01 ContributionBar (matched/unmatched/disputed split) for the selected run, bound to
 * live run counts. Additive — the existing KPIs/run-list/break-queue are untouched.
 */

const WCAG = {
  runOnly: { type: 'tag' as const, values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  rules: { 'color-contrast': { enabled: false } }
}
async function expectNoViolations(ui: ReactElement) {
  const { container } = render(<main>{ui}</main>)
  const results = await axe(container, WCAG)
  expect(results.violations.map((v) => v.id)).toEqual([])
}

const run = (over: Partial<ReconciliationRun> = {}): ReconciliationRun => ({
  id: 'r1',
  run_id: 'RUN-1',
  run_type: 'daily',
  status: 'completed',
  reconciliation_window_start: '2026-06-01',
  reconciliation_window_end: '2026-06-02',
  line_count_total: 1000,
  line_count_matched: 940,
  line_count_unmatched: 50,
  line_count_disputed: 10,
  failure_reason: null,
  created_at: '2026-06-02',
  ...over
})

describe('ReconOutcomePanel', () => {
  it('renders a pass-rate gauge + matched/unmatched/disputed contribution bar from the run', () => {
    render(<ReconOutcomePanel run={run()} />)
    const region = screen.getByRole('region', { name: /reconciliation outcome/i })
    const meter = within(region).getByRole('meter', { name: /pass rate/i })
    expect(meter).toHaveAttribute('aria-valuenow', '94') // 940 / 1000
    // matched segment proportional width (940/1000 = 94 of the 0–100 viewBox)
    expect(within(region).getByTestId('contribution-seg-matched')).toHaveAttribute('width', '94')
    expect(within(region).getByText('Matched')).toBeInTheDocument()
    expect(within(region).getByText('Disputed')).toBeInTheDocument()
  })

  it('handles an empty run without dividing by zero', () => {
    render(<ReconOutcomePanel run={run({ line_count_total: 0, line_count_matched: 0, line_count_unmatched: 0, line_count_disputed: 0 })} />)
    expect(screen.getByRole('meter', { name: /pass rate/i })).toHaveAttribute('aria-valuenow', '0')
  })

  it('has no axe violations', async () => {
    await expectNoViolations(<ReconOutcomePanel run={run()} />)
  })
})
