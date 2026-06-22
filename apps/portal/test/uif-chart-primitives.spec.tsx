// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { axe } from 'vitest-axe'
import type { ReactElement } from 'react'

import { Gauge, Sparkline } from '../src/components/ui/index.js'

afterEach(cleanup)

/**
 * UIF-01b — @visx chart primitives (ADR 0016 D2). Gauge (radial %) and Sparkline (trend
 * line) are the two true charts the Stitch "Refined" screens lead with (System Heartbeat,
 * risk posture, the dashboard metric tiles). Geometry comes from @visx as SVG path/arc
 * ATTRIBUTES (the design-conformance gate forbids inline `style` props); colour is token
 * `stroke-*`/`fill-*` only. Accessibility: Gauge is an ARIA `meter`; Sparkline is a labelled
 * `img`. jsdom can't compute layout, so colour-contrast is validated by the token tests.
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

describe('Gauge', () => {
  it('is an accessible meter carrying value / min / max', () => {
    render(<Gauge value={99.8} max={100} label="System heartbeat" unit="%" />)
    const meter = screen.getByRole('meter', { name: 'System heartbeat' })
    expect(meter).toHaveAttribute('aria-valuenow', '99.8')
    expect(meter).toHaveAttribute('aria-valuemin', '0')
    expect(meter).toHaveAttribute('aria-valuemax', '100')
  })

  it('shows the formatted value with its unit', () => {
    render(<Gauge value={99.8} max={100} label="System heartbeat" unit="%" />)
    expect(screen.getByText('99.8%')).toBeInTheDocument()
  })

  it('clamps an out-of-range value into [0, max]', () => {
    render(<Gauge value={150} max={100} label="Risk posture" unit="%" />)
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '100')
  })

  it('draws the value arc as an SVG path attribute (not an inline style)', () => {
    render(<Gauge value={50} max={100} label="x" />)
    const arc = screen.getByTestId('gauge-value-arc')
    expect(arc.getAttribute('d') ?? '').not.toBe('')
  })

  it('has no axe violations', async () => {
    await expectNoViolations(<Gauge value={42} max={100} label="Risk posture" unit="%" />)
  })
})

describe('Sparkline', () => {
  it('is a labelled image with a drawn trend path', () => {
    render(<Sparkline values={[3, 5, 4, 8, 7, 9]} label="TPP traffic trend" />)
    const img = screen.getByRole('img', { name: 'TPP traffic trend' })
    const path = within(img).getByTestId('sparkline-path')
    expect(path.getAttribute('d') ?? '').not.toBe('')
  })

  it('stays accessible and does not crash with fewer than two points', () => {
    render(<Sparkline values={[5]} label="flat metric" />)
    expect(screen.getByRole('img', { name: 'flat metric' })).toBeInTheDocument()
  })

  it('has no axe violations', async () => {
    await expectNoViolations(<Sparkline values={[1, 2, 3, 2, 4]} label="trend" />)
  })
})
