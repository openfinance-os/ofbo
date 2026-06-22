// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { axe } from 'vitest-axe'
import type { ReactElement } from 'react'

import { AnalyticsSections } from '../src/components/analytics/analytics-sections.js'
import type { AnalyticsSection } from '../src/lib/analytics.js'

afterEach(cleanup)

/**
 * UIF-03 — the typed analytics-section renderer (ADR 0016): maps each AnalyticsSection `kind`
 * to a UIF-01/01b primitive (the shared core UIF-03/-04/-05 all use). Unknown kinds degrade to
 * nothing so the caller can fall back to the generic grid. Bound to the OpenAPI contract.
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

const kpiStrip: AnalyticsSection = {
  kind: 'kpi-strip',
  title: 'Commercial Metrics',
  stats: [
    { label: 'Total fintech revenue', value: 'AED 4.82M' },
    { label: 'Net operating margin', value: '32.8%', sublabel: 'within target (30–35%)', trend: { label: '+12.4% vs prev', tone: 'reconciled' } }
  ]
}
const gauge: AnalyticsSection = { kind: 'gauge', title: 'Reconciliation Health', gauge: { value: 99.2, max: 100, unit: '%' } }
const bars: AnalyticsSection = { kind: 'contribution-bars', title: 'Product Family', segments: [{ label: 'Retail Banking', value: 58 }, { label: 'Treasury', value: 42 }] }
const statusCards: AnalyticsSection = { kind: 'status-cards', title: 'Liability Monitor', cards: [{ label: 'Consent violations', value: 'AED 84k', status: 'breach', note: 'Class-A exposure' }] }
const alert: AnalyticsSection = { kind: 'alert', title: 'Notice', alert: { severity: 'warning', message: 'Operating margin below floor', remediation: 'Review fee schedule' } }
const table: AnalyticsSection = { kind: 'object-table', title: 'Releases', table: { columns: ['name', 'status'], rows: [{ name: 'R1', status: 'go' }] } }

describe('AnalyticsSections', () => {
  it('renders a kpi-strip as labelled stats', () => {
    render(<AnalyticsSections sections={[kpiStrip]} />)
    const region = screen.getByRole('region', { name: /commercial metrics/i })
    expect(within(region).getByText('AED 4.82M')).toBeInTheDocument()
    expect(within(region).getByText('within target (30–35%)')).toBeInTheDocument()
  })

  it('renders a gauge bound to value/max', () => {
    render(<AnalyticsSections sections={[gauge]} />)
    expect(screen.getByRole('meter', { name: /reconciliation health/i })).toHaveAttribute('aria-valuenow', '99.2')
  })

  it('renders contribution bars', () => {
    render(<AnalyticsSections sections={[bars]} />)
    expect(within(screen.getByRole('region', { name: /product family/i })).getByTestId('contribution-seg-retail-banking')).toBeInTheDocument()
  })

  it('renders status cards (label + value, toned by status token)', () => {
    render(<AnalyticsSections sections={[statusCards]} />)
    const region = screen.getByRole('region', { name: /liability monitor/i })
    expect(within(region).getByText('Consent violations')).toBeInTheDocument()
    expect(within(region).getByText('AED 84k')).toBeInTheDocument()
  })

  it('renders an alert with its message', () => {
    render(<AnalyticsSections sections={[alert]} />)
    expect(screen.getByText('Operating margin below floor')).toBeInTheDocument()
  })

  it('renders an object-table', () => {
    render(<AnalyticsSections sections={[table]} />)
    const region = screen.getByRole('region', { name: /releases/i })
    expect(within(region).getByRole('table')).toBeInTheDocument()
    expect(within(region).getByText('R1')).toBeInTheDocument()
  })

  it('degrades an unknown kind to nothing (caller falls back to the grid)', () => {
    render(<AnalyticsSections sections={[{ kind: 'mystery', title: 'Should not render' } as unknown as AnalyticsSection]} />)
    expect(screen.queryByText('Should not render')).not.toBeInTheDocument()
  })

  it('has no axe violations across all kinds', async () => {
    await expectNoViolations(<AnalyticsSections sections={[kpiStrip, gauge, bars, statusCards, alert, table]} />)
  })
})
