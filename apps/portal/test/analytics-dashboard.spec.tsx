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

describe('generic renderer — KPI hierarchy + path references (P1 polish)', () => {
  it('renders a top-level scalar number and Money as a prominent KPI figure', () => {
    render(<MetricGrid data={{ open_nebras_dispute_count: 3, mtd_nebras_fee_accrual: { amount: 481250, currency: 'AED' } }} />)
    const count = screen.getByTestId('kpi-open_nebras_dispute_count')
    expect(count).toHaveTextContent('3')
    expect(count.className).toMatch(/text-3xl/)
    expect(count.className).toMatch(/tabular-nums/)
    expect(screen.getByTestId('kpi-mtd_nebras_fee_accrual')).toHaveTextContent('AED 4,812.50')
  })

  it('does NOT KPI-render objects/arrays (structured render instead)', () => {
    render(<MetricGrid data={{ by_state: { active: 2, dormant: 1 } }} />)
    expect(screen.queryByTestId('kpi-by_state')).not.toBeInTheDocument()
    expect(screen.getByTestId('metric-by_state')).toHaveTextContent('Active')
  })

  it('renders an API/route path string as a muted code reference, not a badge', () => {
    render(<MetricGrid data={{ reconciliation_console_deeplink: '/back-office/reconciliation/runs' }} />)
    const cell = screen.getByTestId('metric-reconciliation_console_deeplink')
    expect(cell.querySelector('code')).toBeInTheDocument()
    expect(cell).toHaveTextContent('/back-office/reconciliation/runs')
  })
})

describe('generic renderer — ISO timestamps render compact (no char-wrap)', () => {
  it('renders an ISO datetime as a single-line date + HH:MM, full value in title', () => {
    render(<MetricGrid data={{ slos: [{ name: 'revoke_ack', last_checked_at: '2026-06-20T11:42:07.123Z' }] }} />)
    const cell = screen.getByTestId('metric-slos')
    expect(cell).toHaveTextContent('2026-06-20 11:42')
    expect(cell).not.toHaveTextContent('11:42:07.123') // seconds trimmed
    expect(cell.querySelector('[title="2026-06-20T11:42:07.123Z"]')).toBeInTheDocument()
  })
})

describe('generic renderer — numeric distributions render as bars', () => {
  it('charts a by_severity-style object as MiniBars (not a key:value list)', () => {
    render(<MetricGrid data={{ by_severity: { critical: 2, high: 4, medium: 6, low: 1 } }} />)
    const cell = screen.getByTestId('metric-by_severity')
    expect(cell.querySelector('[data-testid="mini-bars"]')).toBeInTheDocument()
    expect(cell).toHaveTextContent('Critical')
    expect(cell).toHaveTextContent('6') // medium count
  })
  it('leaves a mixed (non-numeric) object as a key:value list', () => {
    render(<MetricGrid data={{ meta: { period: '2026-06', count: 3 } }} />)
    const cell = screen.getByTestId('metric-meta')
    expect(cell.querySelector('[data-testid="mini-bars"]')).not.toBeInTheDocument()
    expect(cell).toHaveTextContent('Period')
  })
})
