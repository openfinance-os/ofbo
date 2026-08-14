// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { BillingConsole } from '../src/components/billing-console.js'
import type { BillingConsoleView, BillingWriteResult } from '../src/lib/billing-console.js'

afterEach(cleanup)

export const billingView: BillingConsoleView = {
  data: {
    bank_id: '11111111-1111-4111-8111-111111111111',
    period: '2026-07',
    rate_card: {
      version: '2026-06-02',
      label: 'Nebras Commercial & Pricing Model v1.0',
      effective_from: '2026-06-02',
      currency: 'AED',
      year_anchor: { date: '2025-10-01', status: 'ASSUMED', note: 'Tenant-configured until scheme confirmation.' },
      receivable: { 'payment.merchant_collection': {}, 'data.retail_page': {} },
      payable_hub: { 'hub.standard': {}, 'hub.paired': {} }
    },
    invoice: { template_ref: 'pint-ae:default:v1', brand_key: 'alpha-bank' },
    asp_route_profile: 'uae-asp-primary',
    collection_rail_policy: { preferred: 'scheme_net_settlement', fallback: 'uaedds' },
    collections: {
      open_invoice_count: 3,
      open_milli_fils: 91_000_000,
      settlement_break_count: 1,
      settlement_expected_net_milli_fils: 80_000_000,
      settlement_received_milli_fils: 79_000_000,
      settlement_residue_milli_fils: 1_000_000,
      dunning_by_state: { reminder_1: 2 },
      dso_by_tpp: []
    },
    accounting_close_pack: {
      period: '2026-07',
      batch_id: 'GL-2026-07-alpha',
      account_profile_ref: 'p9:alpha',
      balanced: true,
      journal_count: 12,
      debit_fils: 410_000,
      credit_fils: 410_000,
      output_vat_fils: 19_524,
      settlement_residue_fils: 1_000,
      invoice_document_ids: ['INV-001'],
      payable_source_ids: ['HUB-001'],
      settlement_references: ['SET-001']
    },
    revenue_assurance: {
      period: '2026-07',
      generated_at: '2026-08-03T08:00:00Z',
      currency: 'AED',
      metering_coverage_percent: 99.8,
      gross_receivable_milli_fils: 530_000_000,
      leakage_milli_fils: 3_000_000,
      leakage_aed: 30,
      leakage_percent: 0.57,
      counterfactual_opportunity_milli_fils: 6_000_000,
      counterfactual_opportunity_aed: 60,
      recoverable_milli_fils: 3_000_000,
      recovered_revenue_milli_fils: 1_000_000,
      recovered_revenue_aed: 10,
      outstanding_recoverable_milli_fils: 2_000_000,
      findings: [{ code: 'rate_drift', title: 'Rate-card drift', amount_milli_fils: 2_000_000, status: 'query_required', owner: 'Finance', source_refs: ['memo-1'] }],
      target: { threshold_percent: 1, comparison: 'strictly_below', met: true },
      dispute_window: { raised: 1, missed: 0, target_missed: 0 }
    },
    profitability: {
      period: '2026-07',
      currency: 'AED',
      totals: {
        receivable_milli_fils: 530_000_000,
        hub_cost_milli_fils: 105_000_000,
        liability_provision_milli_fils: 20_000_000,
        tpp_aas_margin_milli_fils: 35_000_000,
        profit_milli_fils: 440_000_000
      },
      by_tpp: [{ tpp_id: 'tpp-synthetic-01', profit_milli_fils: 280_000_000, profit_aed: 2800, source_refs: ['invoice-1'] }],
      by_product_family: [{ product_family: 'payments', profit_milli_fils: 310_000_000, profit_aed: 3100, source_refs: ['rated-1'] }],
      reconciliation: { balanced: true, delta_milli_fils: 0 }
    },
    insurance: { status: 'deferred', dependency: 'approved insurance commercial model', story: 'BILL-06' }
  },
  freshness: { view_refreshed_at: '2026-08-13T12:00:00Z', stale: false, stale_cause: null }
}

const action = vi.fn(async (_prev: BillingWriteResult, _form: FormData): Promise<BillingWriteResult> => ({ ok: true }))

describe('BillingConsole', () => {
  it('renders the tenant period, financial control strip, and live operating evidence', () => {
    render(<BillingConsole view={billingView} simulateAction={action} />)

    expect(screen.getByRole('heading', { name: 'Billing Control Plane' })).toBeInTheDocument()
    expect(screen.getByTestId('billing-period')).toHaveTextContent('2026-07')
    expect(screen.getByTestId('kpi-profit')).toHaveTextContent('AED 4,400.00')
    expect(screen.getByTestId('kpi-receivables')).toHaveTextContent('AED 5,300.00')
    expect(screen.getByTestId('kpi-leakage')).toHaveTextContent('0.57%')
    expect(screen.getByTestId('collections-panel')).toHaveTextContent('AED 910.00')
    expect(screen.getByTestId('assurance-panel')).toHaveTextContent('Rate-card drift')
    expect(screen.getByTestId('profitability-panel')).toHaveTextContent('tpp-synthetic-01')
  })

  it('shows resolved tenant configuration, regulator/export actions, and the explicit insurance block', () => {
    render(<BillingConsole view={billingView} simulateAction={action} />)

    expect(screen.getByTestId('rate-card-panel')).toHaveTextContent('2026-06-02')
    expect(screen.getByTestId('rate-card-panel')).toHaveTextContent('ASSUMED')
    expect(screen.getByTestId('tenant-policy-panel')).toHaveTextContent(/scheme net settlement/i)
    expect(screen.getByRole('link', { name: /TPP registry/i })).toHaveAttribute('href', '/tpp-billing')
    expect(screen.getByRole('link', { name: /tenant billing export/i })).toHaveAttribute('href', '/api/billing/portable-export')
    expect(screen.getByTestId('cbuae-export-form')).toBeInTheDocument()
    expect(screen.getByTestId('insurance-deferred')).toHaveTextContent('approved insurance commercial model')
    expect(screen.getByTestId('insurance-deferred')).toHaveTextContent('BILL-06')
  })

  it('renders a real profitability scenario form and handles unavailable evidence without invented values', () => {
    const empty: BillingConsoleView = {
      data: { ...billingView.data, collections: null, accounting_close_pack: null, revenue_assurance: null, profitability: null },
      freshness: billingView.freshness
    }
    render(<BillingConsole view={empty} simulateAction={action} />)

    expect(screen.getByTestId('profitability-simulator')).toBeInTheDocument()
    expect(screen.getByLabelText('Receivable change')).toHaveValue(100)
    expect(screen.getByLabelText('Proposed overage rate (fils)')).toHaveValue(0)
    expect(screen.getAllByText('Awaiting scheduled billing evidence').length).toBeGreaterThan(0)
  })

  it('renders the typed error envelope when the console cannot load', () => {
    render(<BillingConsole error="Tenant is not provisioned." errorRemediation="Provision billing configuration." errorDocsUrl="https://docs.ofbo/billing" simulateAction={action} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Tenant is not provisioned.')
    expect(screen.getByRole('alert')).toHaveTextContent('Provision billing configuration.')
  })
})
