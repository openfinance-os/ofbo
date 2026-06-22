// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { axe } from 'vitest-axe'
import type { ReactElement } from 'react'

import { RegistryFilter } from '../src/components/tpp-billing/registry-filter.js'

afterEach(cleanup)

/**
 * UIF-08b — the scope-aware registry filter (ADR 0016): a GET form that narrows the
 * consuming-TPP registry by registration_state + unbilled-traffic. The BFF does the
 * filtering server-side (CounterpartyQuery); this is the form that drives it. Token-only.
 */

const WCAG = {
  runOnly: { type: 'tag' as const, values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  rules: { 'color-contrast': { enabled: false } }
}
async function expectNoViolations(ui: ReactElement) {
  const { container } = render(ui)
  const results = await axe(container, WCAG)
  expect(results.violations.map((v) => v.id)).toEqual([])
}

describe('RegistryFilter', () => {
  it('is a GET search form with a registration-state select + an unbilled-traffic toggle', () => {
    render(<RegistryFilter />)
    const form = screen.getByTestId('registry-filter')
    expect(form).toHaveAttribute('method', 'get')
    expect(form).toHaveAttribute('action', '/tpp-billing')
    expect(form).toHaveAttribute('role', 'search')
    const select = screen.getByLabelText(/registration state/i)
    expect(select).toHaveAttribute('name', 'reg_state')
    expect(within(select).getByRole('option', { name: 'Registered' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'Onboarding' })).toBeInTheDocument()
    expect(screen.getByLabelText(/unbilled/i)).toHaveAttribute('name', 'unbilled')
  })

  it('reflects the active filter values and offers a clear link', () => {
    render(<RegistryFilter registrationState="onboarding" unbilledOnly />)
    expect(screen.getByLabelText(/registration state/i)).toHaveValue('onboarding')
    expect(screen.getByLabelText(/unbilled/i)).toBeChecked()
    expect(screen.getByRole('link', { name: /clear/i })).toHaveAttribute('href', '/tpp-billing')
  })

  it('omits the clear link when no filter is active', () => {
    render(<RegistryFilter />)
    expect(screen.queryByRole('link', { name: /clear/i })).not.toBeInTheDocument()
  })

  it('has no axe violations', async () => {
    await expectNoViolations(<RegistryFilter registrationState="registered" unbilledOnly />)
  })
})
