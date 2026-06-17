// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { OperationsConsole } from '../src/components/operations-console.js'
import type { AnalyticsView } from '../src/lib/analytics.js'

afterEach(cleanup)

/**
 * UI-09 — Operations Console (presentational). Reuses the UI-06 generic renderer; asserts
 * the aggregate ops view + its freshness indicator render, and the error state behaves.
 */

const view: AnalyticsView = {
  data: {
    slo: [{ name: 'reconciliation', met: true }],
    scheme_certificates: { worst_status: 'amber' },
    connectivity: { status: 'connected' },
    active_outages: []
  },
  freshness: { view_refreshed_at: '2026-06-17T00:00:00Z', stale: false, stale_cause: null }
}

describe('OperationsConsole', () => {
  it('renders the aggregate ops section with its freshness indicator', () => {
    render(<OperationsConsole view={view} />)
    const section = screen.getByTestId('operations-section')
    expect(section).toHaveTextContent('Platform Operations')
    expect(section).toHaveTextContent('Scheme Certificates')
    expect(screen.getByTestId('freshness')).toHaveAttribute('data-stale', 'false')
  })

  it('shows the error banner on failure', () => {
    render(<OperationsConsole view={null} error="The Operations Console is temporarily unavailable." />)
    expect(screen.getByTestId('operations-error')).toHaveTextContent('temporarily unavailable')
    expect(screen.queryByTestId('operations-section')).not.toBeInTheDocument()
  })

  it('shows the empty state when no view and no error', () => {
    render(<OperationsConsole view={null} />)
    expect(screen.getByTestId('operations-empty')).toBeInTheDocument()
  })
})
