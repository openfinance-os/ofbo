// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { Notice, ErrorBanner, StatusBadge, Panel, statusTone, statusToneOrNeutral } from '../src/components/ui/index.js'

afterEach(cleanup)

/**
 * UX-01 — shared UI primitives. Asserts the accessibility contract the screens rely on:
 * Notice = role=status (WCAG 4.1.3), ErrorBanner = role=alert, Panel = a labelled landmark
 * region with an aria-hidden count + sr-only phrase, and one canonical status→tone map so
 * the colour vocabulary cannot drift across screens again.
 */

describe('Notice / ErrorBanner', () => {
  it('Notice is a polite status message', () => {
    render(<Notice testid="n">Saved.</Notice>)
    const el = screen.getByRole('status')
    expect(el).toHaveTextContent('Saved.')
    expect(el).toHaveAttribute('data-testid', 'n')
  })

  it('ErrorBanner is an assertive alert', () => {
    render(<ErrorBanner testid="e">Failed.</ErrorBanner>)
    const el = screen.getByRole('alert')
    expect(el).toHaveTextContent('Failed.')
    expect(el).toHaveAttribute('data-testid', 'e')
  })
})

describe('Panel', () => {
  it('is a region named by its heading, with an accessible count', () => {
    render(
      <Panel title="Break Queue" count={3} countLabel="open breaks" testid="bq">
        <p>body</p>
      </Panel>
    )
    const region = screen.getByRole('region', { name: 'Break Queue' })
    expect(region).toHaveAttribute('data-testid', 'bq')
    // count is announced once (sr-only), the visual badge is aria-hidden
    expect(within(region).getByText('3 open breaks')).toHaveClass('sr-only')
  })

  it('omits the count when not provided', () => {
    render(<Panel title="Runs"><p>x</p></Panel>)
    expect(screen.getByRole('region', { name: 'Runs' })).toBeInTheDocument()
  })
})

describe('status vocabulary (single source of truth)', () => {
  it('maps the triad consistently', () => {
    expect(statusTone('breach')).toContain('text-breach')
    expect(statusTone('pending')).toContain('text-break')
    expect(statusTone('reconciled')).toContain('text-reconciled')
  })

  it('resolves the cross-screen drift case (suspended is amber, not red)', () => {
    // The review found `suspended` rendered red on analytics but amber on care.
    expect(statusTone('suspended')).toContain('text-break')
    expect(statusTone('Suspended')).toContain('text-break')
  })

  it('returns null for unknown tokens but neutral via the OrNeutral helper', () => {
    expect(statusTone('tpp-acme-42')).toBeNull()
    expect(statusToneOrNeutral('tpp-acme-42')).toContain('on-surface-variant')
  })

  it('StatusBadge renders a labelled chip', () => {
    render(<StatusBadge status="reconciled" />)
    expect(screen.getByTestId('status-reconciled')).toHaveTextContent('reconciled')
  })
})
