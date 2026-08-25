// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { axe } from 'vitest-axe'
import type { ReactElement } from 'react'

import { TppCostConsole } from '../src/components/tpp-cost/tpp-cost-console.js'
import {
  blockedVariance,
  dispatchSummary,
  formatMoney,
  totalsByRecipient,
  type TppCostPeriod
} from '../src/lib/tpp-cost.js'

afterEach(cleanup)

/**
 * BILL-17 — the TPP Cost Management console (the payable half of the billing screen).
 *
 * What the tests hold to account, beyond rendering: money is integer minor units on the wire and
 * must be formatted as such (the ledger's finer milli-fils never reaches here); the three cost
 * totals stay SEPARATE per ADR 0007; a blocked period cannot offer a close; and a payable under an
 * unclosed period cannot offer a dispatch, because authority to honour a debit belongs to the
 * period.
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

const noop = vi.fn(async () => ({ ok: true }))

function payable(over: Partial<TppCostPeriod['payables'][number]> = {}): TppCostPeriod['payables'][number] {
  return {
    payable_id: '22222222-2222-4222-8222-222222222222',
    period: '2026-06',
    cost_recipient_type: 'nebras',
    cost_recipient_id: 'NEBRAS',
    document_reference: 'NEB-INV-2026-06',
    gross_amount: { amount: 105_000, currency: 'AED' },
    net_amount: { amount: 100_000, currency: 'AED' },
    vat_amount: { amount: 5_000, currency: 'AED' },
    approval_request_id: null,
    dispatch_state: null,
    dispatched_at: null,
    netted_against: null,
    ...over
  }
}

function view(over: Partial<TppCostPeriod> = {}): TppCostPeriod {
  return {
    period: '2026-06',
    close_state: 'open',
    closed_at: null,
    initiated_by: null,
    approved_by: null,
    approval_request_id: null,
    feeds_monthly_signoff: true,
    open_break_count: 0,
    blockers: [],
    payables: [payable()],
    ...over
  }
}

function renderConsole(v: TppCostPeriod | null, over: Record<string, unknown> = {}) {
  return render(
    <main>
      <TppCostConsole
        view={v}
        period="2026-06"
        canWrite
        closeAction={noop as never}
        dispatchAction={noop as never}
        {...over}
      />
    </main>
  )
}

describe('BILL-17 — cost summarisation', () => {
  it('keeps the Hub and underlying-LFI totals SEPARATE (ADR 0007)', () => {
    // One blended number would hide the only distinction the payable side is organised around.
    const totals = totalsByRecipient([
      payable({ net_amount: { amount: 100_000, currency: 'AED' } }),
      payable({
        payable_id: 'p2',
        cost_recipient_type: 'underlying_lfi',
        cost_recipient_id: 'LFI-ALPHA',
        net_amount: { amount: 40_000, currency: 'AED' }
      })
    ])
    expect(totals.nebras).toEqual({ amount: 100_000, currency: 'AED' })
    expect(totals.underlyingLfi).toEqual({ amount: 40_000, currency: 'AED' })
    expect(totals.total).toEqual({ amount: 140_000, currency: 'AED' })
  })

  it('formats Money as integer MINOR units — 100 fils per AED, not the ledger\'s 100,000', () => {
    expect(formatMoney({ amount: 105_000, currency: 'AED' })).toBe('AED 1,050.00')
    expect(formatMoney({ amount: -1, currency: 'AED' })).toBe('−AED 0.01')
    expect(formatMoney(null)).toBe('—')
  })

  it('sums the disputed amount as ABSOLUTE variance', () => {
    // Two breaks of opposite sign are two arguments with the counterparty, not a net of zero.
    expect(blockedVariance([
      { line_ref: 'a', break_type: 'rate_variance', cost_recipient_type: 'nebras', cost_recipient_id: 'n', variance: { amount: 500, currency: 'AED' }, reconciliation_break_id: null },
      { line_ref: 'b', break_type: 'missing_charge', cost_recipient_type: 'nebras', cost_recipient_id: 'n', variance: { amount: -300, currency: 'AED' }, reconciliation_break_id: null }
    ])).toEqual({ amount: 800, currency: 'AED' })
  })

  it('counts a REJECTED dispatch as outstanding, not settled', () => {
    // A rejected direct debit is money still owed. Reporting it as done is how a payable goes quiet.
    const summary = dispatchSummary([
      payable({ dispatch_state: 'accepted' }),
      payable({ payable_id: 'p2', dispatch_state: 'rejected' }),
      payable({ payable_id: 'p3', dispatch_state: 'dispatched' }),
      payable({ payable_id: 'p4', dispatch_state: null })
    ])
    expect(summary).toEqual({ settled: 1, inFlight: 1, outstanding: 2 })
  })
})

describe('BILL-17 — the console', () => {
  it('renders the cost KPIs from the contract response', () => {
    renderConsole(view({
      payables: [
        payable(),
        payable({ payable_id: 'p2', cost_recipient_type: 'underlying_lfi', net_amount: { amount: 40_000, currency: 'AED' } })
      ]
    }))
    expect(screen.getByTestId('cost-total')).toHaveTextContent('AED 1,400.00')
    expect(screen.getByTestId('cost-nebras')).toHaveTextContent('AED 1,000.00')
    expect(screen.getByTestId('cost-lfi')).toHaveTextContent('AED 400.00')
  })

  it('offers a close on an OPEN period', () => {
    renderConsole(view())
    expect(screen.getByTestId('request-close-form')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /request period close/i })).toBeEnabled()
    expect(screen.getByTestId('close-summary')).toHaveTextContent(/ready for a four-eyes close/i)
  })

  it('REFUSES the close control on a blocked period, and says why', () => {
    renderConsole(view({
      close_state: 'blocked',
      open_break_count: 1,
      blockers: [{
        line_ref: 'NEB-INV-2026-06|SI-1',
        break_type: 'rate_variance',
        cost_recipient_type: 'nebras',
        cost_recipient_id: 'NEBRAS',
        variance: { amount: 250, currency: 'AED' },
        reconciliation_break_id: 'brk-1'
      }]
    }))
    expect(screen.getByRole('button', { name: /request period close/i })).toBeDisabled()
    expect(screen.getByTestId('close-disabled-reason')).toHaveTextContent(/1 unresolved material break/i)
    const blockers = within(screen.getByTestId('cost-blockers'))
    expect(blockers.getByText('Rate Variance')).toBeInTheDocument()
    expect(blockers.getByRole('link', { name: /investigate/i })).toHaveAttribute('href', '/reconciliation/breaks/brk-1')
  })

  it('says when a break is raised but NOT yet escalated, rather than leaving an empty cell', () => {
    renderConsole(view({
      close_state: 'blocked',
      open_break_count: 1,
      blockers: [{
        line_ref: 'L1', break_type: 'vat_variance', cost_recipient_type: 'nebras',
        cost_recipient_id: 'NEBRAS', variance: { amount: 10, currency: 'AED' },
        reconciliation_break_id: null
      }]
    }))
    expect(screen.getByText(/not yet escalated/i)).toBeInTheDocument()
  })

  it('DISABLES dispatch while the period is unclosed — authority belongs to the period', () => {
    renderConsole(view())
    expect(screen.getByRole('button', { name: /dispatch to p9/i })).toBeDisabled()
  })

  it('ENABLES dispatch once the close supplies an approval', () => {
    renderConsole(view({
      close_state: 'closed',
      closed_at: '2026-07-02T09:00:00.000Z',
      initiated_by: 'finance.analyst',
      approved_by: 'finance.controller',
      approval_request_id: 'apr-1',
      payables: [payable({ approval_request_id: 'apr-1' })]
    }))
    expect(screen.getByRole('button', { name: /dispatch to p9/i })).toBeEnabled()
    expect(screen.getByTestId('close-evidence')).toHaveTextContent('finance.controller')
  })

  it('shows the four-eyes notice with a deep link when a close has been requested', () => {
    renderConsole(view(), { approvalRequestId: 'apr-42' })
    const notice = screen.getByTestId('close-approval-notice')
    expect(notice).toHaveTextContent('apr-42')
    expect(within(notice).getByRole('link', { name: /approvals queue/i })).toHaveAttribute('href', '/approvals')
  })

  it('hides every write control from a read-only persona', () => {
    renderConsole(view(), { canWrite: false })
    expect(screen.queryByTestId('request-close-form')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /dispatch to p9/i })).not.toBeInTheDocument()
  })

  it('renders the typed error with remediation instead of a blank panel', () => {
    renderConsole(null, {
      error: 'The TPP cost ledger is temporarily unavailable.',
      errorRemediation: 'Retry once the ledger is reachable.',
      errorDocsUrl: 'https://example.test/docs'
    })
    const banner = screen.getByTestId('tpp-cost-error')
    expect(banner).toHaveTextContent('temporarily unavailable')
    expect(banner).toHaveTextContent('Retry once the ledger is reachable.')
  })

  it('has no axe violations', async () => {
    await expectNoViolations(
      <TppCostConsole
        view={view({
          close_state: 'blocked',
          open_break_count: 1,
          blockers: [{
            line_ref: 'L1', break_type: 'rate_variance', cost_recipient_type: 'nebras',
            cost_recipient_id: 'NEBRAS', variance: { amount: 250, currency: 'AED' },
            reconciliation_break_id: 'brk-1'
          }]
        })}
        period="2026-06"
        canWrite
        closeAction={noop as never}
        dispatchAction={noop as never}
      />
    )
  })
})
