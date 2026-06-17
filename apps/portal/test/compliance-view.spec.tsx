// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ComplianceView } from '../src/components/compliance-view.js'
import type { AnalyticsView } from '../src/lib/analytics.js'

afterEach(cleanup)

const view: AnalyticsView = {
  data: { cbuae_inquiries: { open: 1, closed: 4 }, str_drafts: 0 },
  freshness: { view_refreshed_at: '2026-06-17T00:00:00Z', stale: false, stale_cause: null }
}

describe('ComplianceView', () => {
  it('renders the compliance section with its freshness indicator', () => {
    render(<ComplianceView view={view} />)
    expect(screen.getByTestId('compliance-section')).toHaveTextContent('Compliance Overview')
    expect(screen.getByTestId('freshness')).toHaveAttribute('data-stale', 'false')
  })

  it('shows the error banner on failure', () => {
    render(<ComplianceView view={null} error="The Compliance view is temporarily unavailable." />)
    expect(screen.getByTestId('compliance-error')).toHaveTextContent('temporarily unavailable')
  })

  it('shows the empty state when no view and no error', () => {
    render(<ComplianceView view={null} />)
    expect(screen.getByTestId('compliance-empty')).toBeInTheDocument()
  })
})
