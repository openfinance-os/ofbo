// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { RiskDashboard } from '../src/components/risk-dashboard.js'
import type { AnalyticsView } from '../src/lib/analytics.js'

afterEach(cleanup)

/**
 * UI-07 — Risk Management & Anomaly Detection (presentational). Reuses the UI-06 generic
 * renderer; asserts both sections render per availability, the freshness indicator shows,
 * and the empty/error states behave.
 */

const riskView: AnalyticsView = {
  data: { open_signals: 2, anomalies: [{ rule: 'agent_lookups', count: 140 }] },
  freshness: { view_refreshed_at: '2026-06-17T00:00:00Z', stale: false, stale_cause: null }
}
const liability: AnalyticsView = {
  data: { approaching_threshold: 1, accrued: { amount: 900000, currency: 'AED' } },
  freshness: { view_refreshed_at: '2026-06-17T00:00:00Z', stale: true, stale_cause: 'older_than_2x_source_cadence' }
}

describe('RiskDashboard', () => {
  it('renders both risk sections with their freshness indicators', () => {
    render(<RiskDashboard riskView={riskView} liabilityMonitor={liability} />)
    expect(screen.getByTestId('risk-view-section')).toHaveTextContent('Risk Signals & Anomalies')
    expect(screen.getByTestId('liability-section')).toHaveTextContent('Nebras Liability Monitor')
    // money in the liability accrual renders as major units
    expect(screen.getByTestId('liability-section')).toHaveTextContent('AED 9,000.00')
    // both freshness badges present (one fresh, one stale)
    expect(screen.getAllByTestId('freshness')).toHaveLength(2)
  })

  it('renders only the available section', () => {
    render(<RiskDashboard riskView={riskView} liabilityMonitor={null} />)
    expect(screen.getByTestId('risk-view-section')).toBeInTheDocument()
    expect(screen.queryByTestId('liability-section')).not.toBeInTheDocument()
  })

  it('shows the empty state and the error banner', () => {
    const { rerender } = render(<RiskDashboard riskView={null} liabilityMonitor={null} />)
    expect(screen.getByTestId('risk-empty')).toBeInTheDocument()
    rerender(<RiskDashboard riskView={null} liabilityMonitor={null} error="The Risk View is temporarily unavailable." />)
    expect(screen.getByTestId('risk-error')).toHaveTextContent('temporarily unavailable')
  })
})
