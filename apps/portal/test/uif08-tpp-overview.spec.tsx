// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { axe } from 'vitest-axe'
import type { ReactElement } from 'react'

import { TppBillingOverview } from '../src/components/tpp-billing-overview.js'
import type { TppCounterparty } from '../src/lib/tpp-billing.js'

afterEach(cleanup)

/**
 * UIF-08 — the TPP Billing overview (ADR 0016): a KPI StatStrip (consuming-TPP count,
 * registered, unbilled-traffic, MTD fee accrual) + a registration-state ContributionBar,
 * computed from the live counterparty list. Additive; money summed from integer minor units.
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

const cp = (over: Partial<TppCounterparty> = {}): TppCounterparty => ({
  organisation_id: 'org-1',
  legal_name: 'Acme TPP',
  registration_number: null,
  directory_contacts: [],
  directory_synced_at: '2026-06-20',
  production_status: 'live',
  first_traffic_at: '2026-06-01',
  registration_state: 'registered',
  financial_system_ref: 'FS-1',
  unbilled_traffic: false,
  mtd_fee_accrual: { amount: 100000, currency: 'AED' },
  channel: 'external_tpp_aas',
  ...over
})

const list: TppCounterparty[] = [
  cp({ organisation_id: 'o1', registration_state: 'registered', unbilled_traffic: false, mtd_fee_accrual: { amount: 100000, currency: 'AED' } }),
  cp({ organisation_id: 'o2', registration_state: 'onboarding', unbilled_traffic: true, mtd_fee_accrual: { amount: 50000, currency: 'AED' } }),
  cp({ organisation_id: 'o3', registration_state: 'unregistered', unbilled_traffic: true, mtd_fee_accrual: null })
]

describe('TppBillingOverview', () => {
  it('summarises the counterparty list into KPIs (count, registered, unbilled, MTD accrual)', () => {
    render(<TppBillingOverview counterparties={list} />)
    const region = screen.getByRole('region', { name: /billing overview/i })
    expect(within(region).getByTestId('kpi-total-tpps')).toHaveTextContent('3')
    expect(within(region).getByTestId('kpi-registered')).toHaveTextContent('1')
    expect(within(region).getByTestId('kpi-unbilled')).toHaveTextContent('2')
    // MTD fee accrual summed from integer minor units (100000 + 50000 = 150000 → AED 1,500.00)
    expect(within(region).getByTestId('kpi-mtd')).toHaveTextContent('AED 1,500.00')
  })

  it('shows the registration-state distribution as a contribution bar', () => {
    render(<TppBillingOverview counterparties={list} />)
    const region = screen.getByRole('region', { name: /billing overview/i })
    // 3 states present (registered/onboarding/unregistered), each one of three → ~33%
    expect(within(region).getByTestId('contribution-seg-registered')).toBeInTheDocument()
    expect(within(region).getByText('Onboarding')).toBeInTheDocument()
  })

  it('has no axe violations', async () => {
    await expectNoViolations(<TppBillingOverview counterparties={list} />)
  })
})
