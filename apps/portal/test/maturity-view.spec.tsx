// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MaturityView } from '../src/components/readiness/maturity-view.js'
import type { MaturitySummary } from '../src/lib/readiness.js'

afterEach(cleanup)

const maturity: MaturitySummary = {
  milestones: [
    { id: 'M0', title: 'Foundation', status: 'done', detail: 'repo' },
    { id: 'M6', title: 'Enterprise port-swaps', status: 'remaining', detail: 'adapters' }
  ],
  ports: [
    { id: 'P2', name: 'Enterprise IdP', sim_status: 'ready', enterprise_status: 'stub', contract_test_gate: 'gate-P2' }
  ],
  summary: { milestones_total: 7, milestones_done: 6, ports_total: 9, sim_adapters_ready: 9, enterprise_adapters_remaining: 9, note: 'bounded' }
}

describe('MaturityView', () => {
  it('renders the headline stats, the roadmap, and the per-port adapter table', () => {
    render(<MaturityView maturity={maturity} />)
    expect(screen.getByTestId('maturity-view')).toBeInTheDocument()
    expect(screen.getByText('6/7')).toBeInTheDocument()
    expect(screen.getByTestId('milestone-M0')).toHaveTextContent('delivered')
    expect(screen.getByTestId('milestone-M6')).toHaveTextContent('remaining')
    const p2 = screen.getByTestId('maturity-port-P2')
    expect(p2).toHaveTextContent('ready')
    expect(p2).toHaveTextContent('to write (M6)')
    expect(p2).toHaveTextContent('gate-P2')
  })

  it('shows a reference enterprise adapter as ready (not "to write"), and 0 remaining reads positive', () => {
    const allReady: MaturitySummary = {
      ...maturity,
      ports: [{ id: 'P2', name: 'Enterprise IdP', sim_status: 'ready', enterprise_status: 'ready', contract_test_gate: 'gate-P2' }],
      summary: { ...maturity.summary, enterprise_adapters_remaining: 0 }
    }
    render(<MaturityView maturity={allReady} />)
    const p2 = screen.getByTestId('maturity-port-P2')
    expect(p2).toHaveTextContent('ready')
    expect(p2).not.toHaveTextContent('to write (M6)')
    // 0-remaining stat uses the positive tone, not the break tone
    expect(screen.getByText('0').className).toContain('text-reconciled')
  })
})
