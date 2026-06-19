// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { AnalyticsDashboard, FreshnessBadge, MetricGrid } from '../src/components/analytics-dashboard.js'
import type { AnalyticsView } from '../src/lib/analytics.js'

afterEach(cleanup)

/**
 * UI-06 — Analytics & Insights Dashboard (presentational). Asserts the generic
 * (contract-first) metric renderer handles money/scalars/nested objects, the
 * data-freshness indicator (-40) reflects stale/fresh, and sections render per entitlement.
 */

const exec: AnalyticsView = {
  data: {
    period: '2026-06',
    headline: { consent_volumes: 1200, tpp_aas_margin: { amount: 145000, currency: 'AED' } },
    available_angles: ['commercial']
  },
  freshness: { view_refreshed_at: '2026-06-17T00:00:00Z', stale: false, stale_cause: null }
}
const finance: AnalyticsView = {
  data: { period: '2026-06', open_nebras_dispute_count: 3 },
  freshness: { view_refreshed_at: '2026-06-17T00:00:00Z', stale: true, stale_cause: 'last_ingestion_failed' }
}

describe('FreshnessBadge', () => {
  it('shows Fresh when not stale and the cause when stale', () => {
    const { rerender } = render(<FreshnessBadge freshness={exec.freshness} />)
    expect(screen.getByTestId('freshness')).toHaveAttribute('data-stale', 'false')
    expect(screen.getByTestId('freshness')).toHaveTextContent('Fresh')
    rerender(<FreshnessBadge freshness={finance.freshness} />)
    expect(screen.getByTestId('freshness')).toHaveAttribute('data-stale', 'true')
    expect(screen.getByTestId('freshness')).toHaveTextContent('last_ingestion_failed')
  })
})

describe('MetricGrid (generic renderer)', () => {
  it('renders a panel per top-level key, formatting money and nested objects', () => {
    render(<MetricGrid data={exec.data} />)
    expect(screen.getByTestId('metric-period')).toHaveTextContent('2026-06')
    const headline = screen.getByTestId('metric-headline')
    expect(headline).toHaveTextContent('Consent Volumes')
    expect(headline).toHaveTextContent('AED 1,450.00') // money minor units → major
  })
})

describe('AnalyticsDashboard', () => {
  it('renders only the sections the principal is entitled to', () => {
    const { rerender } = render(<AnalyticsDashboard executive={exec} finance={finance} />)
    expect(screen.getByTestId('executive-section')).toBeInTheDocument()
    expect(screen.getByTestId('finance-section')).toBeInTheDocument()

    rerender(<AnalyticsDashboard executive={exec} finance={null} />)
    expect(screen.getByTestId('executive-section')).toBeInTheDocument()
    expect(screen.queryByTestId('finance-section')).not.toBeInTheDocument()
  })

  it('shows the empty state when no view is available and the error banner on failure', () => {
    const { rerender } = render(<AnalyticsDashboard executive={null} finance={null} />)
    expect(screen.getByTestId('analytics-empty')).toBeInTheDocument()
    rerender(<AnalyticsDashboard executive={null} finance={null} error="The Finance View is temporarily unavailable." />)
    expect(screen.getByTestId('analytics-error')).toHaveTextContent('temporarily unavailable')
  })
})

describe('generic renderer — tables, status badges, no {…} placeholders (P0 polish)', () => {
  const opsData = {
    slos: [
      { name: 'revoke_ack', status: 'healthy', breach_count: 0 },
      { name: 'recon_run', status: 'breach', breach_count: 2 }
    ],
    scheme_certificates: { worst_status: 'critical', chain: [{ cn: 'root', status: 'up' }] },
    nebras_connectivity: { status: 'unknown' }
  }

  it('renders a uniform array of objects as a table (not {…})', () => {
    render(<MetricGrid data={opsData} />)
    const slos = screen.getByTestId('metric-slos')
    expect(slos.querySelector('table')).toBeInTheDocument()
    expect(slos).toHaveTextContent('Name')
    expect(slos).toHaveTextContent('Breach Count')
    expect(slos).not.toHaveTextContent('{…}')
  })

  it('badges operational status strings via the status triad', () => {
    render(<MetricGrid data={opsData} />)
    // worst_status: critical → breach-toned badge (text is lower-case; uppercase is CSS-only)
    expect(screen.getByTestId('status-critical')).toHaveTextContent('critical')
    // status: unknown → neutral badge
    expect(screen.getByTestId('status-unknown')).toBeInTheDocument()
  })

  it('never prints the {…} placeholder anywhere in the grid', () => {
    render(<MetricGrid data={opsData} />)
    expect(screen.getByTestId('metric-grid')).not.toHaveTextContent('{…}')
  })
})
