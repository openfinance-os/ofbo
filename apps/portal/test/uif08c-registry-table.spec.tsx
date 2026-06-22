// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { axe } from 'vitest-axe'
import type { ReactElement } from 'react'

import { RegistryTable } from '../src/components/tpp-billing.js'
import type { TppCounterparty } from '../src/lib/tpp-billing.js'

afterEach(cleanup)

/**
 * UIF-08c — the consuming-TPP registry as a semantic columnar table (ADR 0016, Stitch
 * 3d6d14a3): replaces the card-list with a real <table> (TPP / status / MTD accrual / action),
 * preserving the existing data + testids. Token-only.
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
  production_status: 'active_traffic',
  first_traffic_at: '2026-06-01',
  registration_state: 'registered',
  financial_system_ref: 'FS-1',
  unbilled_traffic: true,
  mtd_fee_accrual: { amount: 150000, currency: 'AED' },
  channel: 'external_tpp_aas',
  ...over
})

describe('RegistryTable — columnar layout', () => {
  it('renders the registry as a table with column headers + a row per counterparty', () => {
    render(<RegistryTable counterparties={[cp()]} />)
    const table = within(screen.getByTestId('registry')).getByRole('table')
    expect(within(table).getByRole('columnheader', { name: /TPP/i })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: /MTD accrual/i })).toBeInTheDocument()
    // existing data + testids preserved on the row
    expect(within(table).getByTestId('accrual-org-1')).toHaveTextContent('AED 1,500.00')
    expect(within(table).getByTestId('unbilled-org-1')).toBeInTheDocument()
    expect(within(table).getByText('Acme TPP')).toBeInTheDocument()
  })

  it('keeps the empty state when there are no counterparties', () => {
    render(<RegistryTable counterparties={[]} />)
    expect(screen.getByTestId('registry-empty')).toBeInTheDocument()
    expect(within(screen.getByTestId('registry')).queryByRole('table')).not.toBeInTheDocument()
  })

  it('has no axe violations', async () => {
    await expectNoViolations(<RegistryTable counterparties={[cp(), cp({ organisation_id: 'org-2', unbilled_traffic: false })]} />)
  })
})
