// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { axe } from 'vitest-axe'
import type { ReactElement } from 'react'

import { EventTimeline } from '../src/components/care/event-timeline.js'
import type { CareTimeline, CareTimelineEvent } from '../src/lib/care.js'

afterEach(cleanup)

/**
 * UIF-09 — the care console's 24-month event history as a connected, type-coloured timeline
 * (ADR 0016, Stitch 39ce3cee): a UIF-01 SectionCard with dots coloured by the event_type enum.
 * PII discipline preserved — psu_identifier is NEVER rendered. Token-only.
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

const ev = (over: Partial<CareTimelineEvent> = {}): CareTimelineEvent => ({
  id: 'ev-1',
  consent_id: 'c-1',
  psu_identifier: 'cust-1',
  event_type: 'granted',
  event_subtype: 'AIS Access',
  event_data: {},
  acting_principal: 'sys',
  created_at: '2025-01-01T00:00:00.000Z',
  ...over
})
const tl = (events: CareTimelineEvent[]): CareTimeline => ({ events, next_cursor: null })

describe('EventTimeline', () => {
  it('is a 24-month event history region with a row per event (testids preserved)', () => {
    render(<EventTimeline timeline={tl([ev(), ev({ id: 'ev-2', event_type: 'revoked' })])} />)
    const region = screen.getByRole('region', { name: /24-month event history/i })
    expect(region).toHaveAttribute('data-testid', 'event-history')
    expect(within(region).getByTestId('event-ev-1')).toHaveTextContent('granted')
  })

  it('colours each timeline dot by the event_type enum', () => {
    render(<EventTimeline timeline={tl([ev({ id: 'g', event_type: 'granted' }), ev({ id: 'r', event_type: 'revoked' }), ev({ id: 'm', event_type: 'modified' })])} />)
    expect(screen.getByTestId('event-dot-g').className).toMatch(/bg-reconciled/)
    expect(screen.getByTestId('event-dot-r').className).toMatch(/bg-breach/)
    expect(screen.getByTestId('event-dot-m').className).toMatch(/bg-break/)
  })

  it('never renders the PSU identifier (PII discipline)', () => {
    render(<EventTimeline timeline={tl([ev({ psu_identifier: 'cust-SECRET' })])} />)
    expect(screen.queryByText(/cust-SECRET/)).not.toBeInTheDocument()
  })

  it('shows the empty state when there are no events', () => {
    render(<EventTimeline timeline={tl([])} />)
    expect(screen.getByTestId('timeline-empty')).toBeInTheDocument()
  })

  it('has no axe violations', async () => {
    await expectNoViolations(<EventTimeline timeline={tl([ev(), ev({ id: 'ev-2', event_type: 'revoked' })])} />)
  })
})
