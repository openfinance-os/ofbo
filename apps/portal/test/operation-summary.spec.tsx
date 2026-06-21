// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { OperationSummary } from '../src/components/operation-summary.js'

afterEach(cleanup)

/**
 * UX-03c / ADR 0014 — the portal renders the BFF's NON-PII operation_summary on the four-eyes
 * surface so the second approver sees real context. Display-only.
 */
describe('OperationSummary', () => {
  it('renders the descriptor, formatted amount, and masked counterparty', () => {
    render(
      <OperationSummary
        summary={{ amount: { amount: 145000, currency: 'AED' }, counterparty_label: 'Acme PISP', descriptor: 'Dispute refund' }}
        testid="op"
      />
    )
    expect(screen.getByTestId('op')).toHaveTextContent('Dispute refund')
    expect(screen.getByTestId('operation-summary-amount')).toHaveTextContent('AED 1,450.00')
    expect(screen.getByTestId('op')).toHaveTextContent('Acme PISP')
  })

  it('renders nothing when there is no summary (older requests / unmodelled types)', () => {
    const { container } = render(<OperationSummary summary={null} testid="op" />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('op')).not.toBeInTheDocument()
  })

  it('renders nothing when the summary has no usable fields', () => {
    const { container } = render(<OperationSummary summary={{ amount: null, descriptor: null, counterparty_label: null }} testid="op" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a descriptor-only summary without an amount node', () => {
    render(<OperationSummary summary={{ descriptor: 'Compliance report submission' }} testid="op" />)
    expect(screen.getByTestId('op')).toHaveTextContent('Compliance report submission')
    expect(screen.queryByTestId('operation-summary-amount')).not.toBeInTheDocument()
  })
})
