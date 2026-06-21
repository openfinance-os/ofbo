// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { axe } from 'vitest-axe'
import type { ReactElement } from 'react'

import { KpiStat, StatStrip, SectionCard, ContributionBar } from '../src/components/ui/index.js'

afterEach(cleanup)

// Same gate the UX-01 a11y spec uses: assert on violated WCAG rule ids (jsdom can't compute
// layout, so colour-contrast is validated by the token tests, not here).
const WCAG = {
  runOnly: { type: 'tag' as const, values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  rules: { 'color-contrast': { enabled: false } }
}
async function expectNoViolations(ui: ReactElement) {
  const { container } = render(<main>{ui}</main>)
  const results = await axe(container, WCAG)
  expect(results.violations.map((v) => v.id)).toEqual([])
}

/**
 * UIF-01 — token-bound presentation primitives (ADR 0016). The Stitch "Refined" screens are
 * built from a small vocabulary of big-number stats, metric strips, named panels, and
 * horizontal contribution bars; none existed, so screens collapsed to generic KPI cards.
 * These assert the shared structure + accessibility contract so every UIF screen composes
 * the same parts. Token-only (no raw hex/px); colour-contrast is validated by the token tests.
 */

describe('KpiStat', () => {
  it('renders a labelled big-number with a mono tabular value', () => {
    render(<KpiStat label="Open reconciliation breaks" value="0" />)
    // the value is programmatically associated with its label (no number-alone)
    const stat = screen.getByRole('group', { name: 'Open reconciliation breaks' })
    const value = within(stat).getByTestId('kpi-value')
    expect(value).toHaveTextContent('0')
    // big-number hierarchy + mono tabular-nums so digits align across a strip
    expect(value).toHaveClass('font-mono', 'tabular-nums')
  })

  it('shows an optional sublabel and a toned trend delta', () => {
    render(
      <KpiStat
        label="Net operating margin"
        value="32.8%"
        sublabel="within target (30–35%)"
        trend={{ label: '+12.4% vs prev', tone: 'reconciled' }}
      />
    )
    expect(screen.getByText('within target (30–35%)')).toBeInTheDocument()
    expect(screen.getByText('+12.4% vs prev')).toHaveClass('text-reconciled')
  })

  it('has no axe violations', async () => {
    await expectNoViolations(<KpiStat label="Open risk signals" value="3" />)
  })
})

describe('StatStrip', () => {
  it('lays its children out as a labelled group of stats', () => {
    render(
      <StatStrip aria-label="Commercial metrics">
        <KpiStat label="Revenue" value="AED 4.82M" valueTestid="rev" />
        <KpiStat label="Margin" value="32.8%" valueTestid="mar" />
      </StatStrip>
    )
    const strip = screen.getByRole('group', { name: 'Commercial metrics' })
    expect(within(strip).getByTestId('rev')).toHaveTextContent('AED 4.82M')
    expect(within(strip).getByTestId('mar')).toHaveTextContent('32.8%')
  })
})

describe('SectionCard', () => {
  it('is a region named by its heading with an optional action slot', () => {
    render(
      <SectionCard title="Compliance Hub" action={<button>Generate CBUAE Pack</button>} testid="hub">
        <p>body</p>
      </SectionCard>
    )
    const region = screen.getByRole('region', { name: 'Compliance Hub' })
    expect(region).toHaveAttribute('data-testid', 'hub')
    expect(within(region).getByRole('button', { name: 'Generate CBUAE Pack' })).toBeInTheDocument()
    expect(within(region).getByText('body')).toBeInTheDocument()
  })

  it('has no axe violations', async () => {
    await expectNoViolations(
      <SectionCard title="Nebras-Liability Monitor"><p>x</p></SectionCard>
    )
  })
})

describe('ContributionBar', () => {
  it('renders proportional segments with accessible labels and values', () => {
    render(
      <ContributionBar
        label="Product family contribution"
        segments={[
          { label: 'Retail Banking', value: 58 },
          { label: 'Corporate Treasury', value: 22 },
          { label: 'VAS & Identity', value: 20 }
        ]}
      />
    )
    const retail = screen.getByTestId('contribution-seg-retail-banking')
    // proportional geometry lives in the SVG rect width (0–100 viewBox), NOT an inline
    // style prop — the design-conformance gate forbids style={{ }} in components.
    expect(retail).toHaveAttribute('width', '58')
    // the segment is legible to AT (label + value), not colour-alone
    expect(screen.getByText('Retail Banking')).toBeInTheDocument()
    expect(screen.getByText('58%')).toBeInTheDocument()
  })

  it('normalises to the segment total when it is not 100', () => {
    render(
      <ContributionBar
        label="Split"
        segments={[
          { label: 'A', value: 30 },
          { label: 'B', value: 10 }
        ]}
      />
    )
    // 30 of 40 → 75
    expect(screen.getByTestId('contribution-seg-a')).toHaveAttribute('width', '75')
  })

  it('has no axe violations', async () => {
    await expectNoViolations(
      <ContributionBar label="Split" segments={[{ label: 'A', value: 1 }]} />
    )
  })
})
