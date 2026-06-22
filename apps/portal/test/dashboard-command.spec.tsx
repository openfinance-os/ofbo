// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { axe } from 'vitest-axe'
import type { ReactElement } from 'react'

import { SystemHealthPanel, FourEyesQueuePanel } from '../src/components/dashboard-command.js'
import type { ApprovalRequest } from '../src/lib/approvals.js'

afterEach(cleanup)

/**
 * UIF-06 — the two bespoke "Executive Command" panels added to the dashboard (ADR 0016):
 * a System-Heartbeat Gauge bound to the real reconciliation pass rate, and a Four-Eyes Queue
 * that lists pending approvals as deep-links — NEVER inline approve/reject (four-eyes is
 * 202 + approval, executed BFF-side by a second principal). Token-only; bound to live data.
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

// a fixed "now" so the relative-expiry render is deterministic
const NOW = Date.parse('2026-06-22T12:00:00Z')
const appr = (over: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  approval_request_id: 'ar-1',
  operation_type: 'tpp_billing.invoice_run',
  state: 'pending',
  initiator: 'op-1',
  approver_required_scope: 'billing:write',
  approver: null,
  expires_at: '2026-06-22T13:00:00Z',
  reject_reason: null,
  operation_summary: { amount: { amount: 150000, currency: 'AED' }, counterparty_label: 'TPP Acme', descriptor: 'May invoice run' },
  ...over
})

describe('SystemHealthPanel', () => {
  it('renders a System Health gauge bound to the reconciliation pass rate', () => {
    render(<SystemHealthPanel passRate={99.2} />)
    const region = screen.getByRole('region', { name: /system health/i })
    const meter = within(region).getByRole('meter', { name: /reconciliation pass rate/i })
    expect(meter).toHaveAttribute('aria-valuenow', '99.2')
    expect(within(region).getByText('99.2%')).toBeInTheDocument()
  })

  it('has no axe violations', async () => {
    await expectNoViolations(<SystemHealthPanel passRate={88} />)
  })
})

describe('FourEyesQueuePanel', () => {
  it('lists each pending approval as a deep-link to its detail, with non-PII operation context', () => {
    render(<FourEyesQueuePanel approvals={[appr(), appr({ approval_request_id: 'ar-2', operation_summary: null })]} now={NOW} />)
    const region = screen.getByRole('region', { name: /four-eyes queue/i })
    expect(within(region).getByTestId('queue-row-ar-1').closest('a')).toHaveAttribute('href', '/approvals/ar-1')
    expect(within(region).getByTestId('queue-row-ar-2').closest('a')).toHaveAttribute('href', '/approvals/ar-2')
    // the redacted operation summary is shown (money formatted from minor units)
    expect(within(region).getByText(/AED 1,500\.00/)).toBeInTheDocument()
    expect(within(region).getByText(/May invoice run/)).toBeInTheDocument()
  })

  it('never renders inline approve/reject controls (four-eyes executes BFF-side)', () => {
    render(<FourEyesQueuePanel approvals={[appr()]} now={NOW} />)
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument()
  })

  it('shows an empty state when the queue is clear', () => {
    render(<FourEyesQueuePanel approvals={[]} now={NOW} />)
    expect(screen.getByText(/no pending .*approvals/i)).toBeInTheDocument()
  })

  it('has no axe violations', async () => {
    await expectNoViolations(<FourEyesQueuePanel approvals={[appr()]} now={NOW} />)
  })
})
