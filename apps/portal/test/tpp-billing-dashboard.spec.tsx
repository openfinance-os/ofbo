// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { RegistryTable, TppBilling } from '../src/components/tpp-billing.js'
import type { InvoiceRun, TppCounterparty } from '../src/lib/tpp-billing.js'

afterEach(cleanup)

/**
 * UI-08 — TPP Billing & Registry (presentational). Asserts the registry renders fee
 * accruals + unbilled-traffic flags, the P9 register action shows only for a registerable
 * counterparty with billing:write, the sync button is ops-gated, and the invoice-run form
 * is billing-gated (four-eyes — submitted, not dispatched inline).
 */

const pendingTpp: TppCounterparty = {
  organisation_id: 'org-1',
  legal_name: 'Acme Open Finance',
  registration_number: 'CN-1',
  directory_contacts: [],
  directory_synced_at: '2026-06-17T00:00:00Z',
  production_status: 'production',
  first_traffic_at: '2026-05-01T00:00:00Z',
  registration_state: 'onboarding',
  financial_system_ref: null,
  unbilled_traffic: true,
  mtd_fee_accrual: { amount: 145000, currency: 'AED' },
  channel: 'internal_retail'
}
const registeredTpp: TppCounterparty = { ...pendingTpp, organisation_id: 'org-2', registration_state: 'registered', financial_system_ref: 'P9-22', unbilled_traffic: false }
const invoiceRun: InvoiceRun = { invoice_run_id: 'inv-1', billing_period: '2026-06', record_set_id: 'rec-1', status: 'pending_approval', approval_id: 'ap-1', invoices: [{}], withheld_line_count: 2, net_settlement_offset: { amount: 50000, currency: 'AED' } }

const noop = () => {}

describe('RegistryTable', () => {
  it('renders fee accrual + unbilled flag, and offers P9 register only for a registerable TPP with billing:write', () => {
    render(<RegistryTable counterparties={[pendingTpp, registeredTpp]} canBilling registerAction={noop} />)
    expect(screen.getByTestId('accrual-org-1')).toHaveTextContent('AED 1,450.00')
    expect(screen.getByTestId('unbilled-org-1')).toBeInTheDocument()
    expect(screen.getByTestId('register-form-org-1')).toBeInTheDocument()
    // already registered → no register action
    expect(screen.queryByTestId('register-form-org-2')).not.toBeInTheDocument()
  })

  it('hides the register action without billing:write', () => {
    render(<RegistryTable counterparties={[pendingTpp]} canBilling={false} registerAction={noop} />)
    expect(screen.queryByTestId('register-form-org-1')).not.toBeInTheDocument()
  })
})

describe('TppBilling', () => {
  it('shows the sync button only with ops:write and the invoice-run form only with billing:write', () => {
    const { rerender } = render(<TppBilling counterparties={[pendingTpp]} invoiceRuns={[invoiceRun]} canBilling canOps registerAction={noop} syncAction={noop} invoiceRunAction={noop} />)
    expect(screen.getByTestId('sync-form')).toBeInTheDocument()
    expect(screen.getByTestId('invoice-run-form')).toBeInTheDocument()
    expect(within(screen.getByTestId('invoice-runs')).getByTestId('invoice-run-inv-1')).toHaveTextContent('2026-06')

    rerender(<TppBilling counterparties={[pendingTpp]} invoiceRuns={[]} canBilling={false} canOps={false} registerAction={noop} syncAction={noop} invoiceRunAction={noop} />)
    expect(screen.queryByTestId('sync-form')).not.toBeInTheDocument()
    expect(screen.queryByTestId('invoice-run-form')).not.toBeInTheDocument()
  })

  it('shows the four-eyes notice and the error banner', () => {
    const { rerender } = render(<TppBilling notice="Invoice run submitted to four-eyes — a second authorised principal approves before P9 dispatch." />)
    expect(screen.getByTestId('tpp-notice')).toHaveTextContent('four-eyes')
    rerender(<TppBilling error="Directory sync failed. Try again." />)
    expect(screen.getByTestId('tpp-error')).toHaveTextContent('sync failed')
  })
})
