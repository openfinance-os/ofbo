// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { axe } from 'vitest-axe'
import type { ReactElement } from 'react'

import { ReconFinancePanel } from '../src/components/recon-finance.js'
import { reconFinanceFromView } from '../src/lib/recon-finance.js'
import type { AnalyticsView } from '../src/lib/analytics.js'

afterEach(cleanup)

/**
 * UIF-07b — TPP-aaS Financial Reconciliation panel: the three reconciliation sources at the
 * money level (A = Nebras billing, C = fintech re-bill, net margin = C − A) + Margin-by-Fintech
 * + Margin-by-Product-Family, parsed from the BACKOFFICE-31 Finance View. Additive.
 */
const WCAG = { runOnly: { type: 'tag' as const, values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }
const noViolations = async (ui: ReactElement) => {
  const results = await axe(render(ui).container, WCAG)
  expect(results.violations.map((v) => v.id)).toEqual([])
}

const view = (over: Partial<AnalyticsView['data']> = {}): AnalyticsView => ({
  freshness: { view_refreshed_at: '2026-06-22T00:00:00.000Z', stale: false, stale_cause: null },
  data: {
    period: '2026-06',
    open_nebras_dispute_count: 2,
    three_way_source_totals: {
      nebras_billing: { amount: 4500, currency: 'AED' },
      platform_metering: { amount: 4480, currency: 'AED' },
      fintech_rebill: { amount: 8400, currency: 'AED' }
    },
    tpp_aas_margin: {
      currency: 'AED',
      total_nebras_fee: 4500,
      total_fintech_charge: 8400,
      total_margin: 3900,
      by_fintech: {
        'org-11111111': { total_margin: 2500, by_family: { SIP: { margin: 1500 }, AISP: { margin: 1000 } } },
        'org-22222222': { total_margin: 1400, by_family: { AISP: { margin: 900 }, CoP: { margin: 500 } } }
      }
    },
    ...over
  }
})

describe('reconFinanceFromView (parser)', () => {
  it('derives the three source totals, margin, and per-fintech / per-family breakdown', () => {
    const f = reconFinanceFromView(view())!
    expect(f.nebras_billed).toEqual({ amount: 4500, currency: 'AED' })
    expect(f.fintech_rebilled).toEqual({ amount: 8400, currency: 'AED' })
    expect(f.net_margin).toEqual({ amount: 3900, currency: 'AED' })
    expect(f.open_nebras_disputes).toBe(2)
    // by_fintech sorted by margin desc
    expect(f.by_fintech.map((x) => x.margin)).toEqual([2500, 1400])
    // by_family aggregated across fintechs: SIP 1500, AISP 1900, CoP 500
    expect(Object.fromEntries(f.by_family.map((x) => [x.family, x.margin]))).toEqual({ AISP: 1900, SIP: 1500, CoP: 500 })
  })

  it('parses the three reconciliation SOURCE totals (A Nebras / B platform metering / C fintech)', () => {
    const f = reconFinanceFromView(view())!
    expect(f.source_totals).toEqual({
      nebras: { amount: 4500, currency: 'AED' },
      platform: { amount: 4480, currency: 'AED' },
      fintech: { amount: 8400, currency: 'AED' }
    })
  })

  it('source_totals is null when the view omits three_way_source_totals (degrades)', () => {
    expect(reconFinanceFromView(view({ three_way_source_totals: undefined }))!.source_totals).toBeNull()
  })

  it('returns null when the view carries no margin (degrade-to-nothing)', () => {
    expect(reconFinanceFromView(view({ tpp_aas_margin: undefined }))).toBeNull()
  })
})

describe('ReconFinancePanel', () => {
  it('renders the headline strip, the three-way SOURCE comparison table, and the margin breakdowns', () => {
    const f = reconFinanceFromView(view())!
    render(<ReconFinancePanel finance={f} />)
    const panel = screen.getByTestId('recon-finance-panel')
    expect(within(panel).getByTestId('recon-fin-nebras')).toHaveTextContent('AED 45.00')
    expect(within(panel).getByTestId('recon-fin-fintech')).toHaveTextContent('AED 84.00')
    expect(within(panel).getByTestId('recon-fin-margin')).toHaveTextContent('AED 39.00')
    // the three-source comparison table — A, B (the previously-missing metering total), C
    const table = within(panel).getByTestId('three-source-table')
    expect(within(table).getByTestId('src-nebras')).toHaveTextContent('AED 45.00')
    expect(within(table).getByTestId('src-platform')).toHaveTextContent('AED 44.80')
    expect(within(table).getByTestId('src-fintech')).toHaveTextContent('AED 84.00')
    // both contribution bars present (by fintech + by family)
    expect(within(panel).getByRole('group', { name: 'Margin by fintech' })).toBeInTheDocument()
    expect(within(panel).getByRole('group', { name: 'Margin by product family' })).toBeInTheDocument()
  })

  it('has no axe violations', async () => {
    const f = reconFinanceFromView(view())!
    await noViolations(<ReconFinancePanel finance={f} />)
  })
})
