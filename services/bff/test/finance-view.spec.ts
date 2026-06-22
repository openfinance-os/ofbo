import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { FinanceViewService, FinanceViewError } from '../src/analytics/finance-view.js'
import { ScopeDeniedError } from '../src/rbac.js'
import type { Principal } from '../src/auth.js'
import type { FeeAccrual } from '@ofbo/db'
import { emptyMargin, type MarginSummary } from '../src/reconciliation/margin.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-31 — Finance View: MTD Nebras fee accrual (BACKOFFICE-32 aggregates),
 * TPP-aaS margin by fintech/family (BACKOFFICE-07), open Nebras dispute queue, and
 * the unbilled-traffic signal (BACKOFFICE-72) — reconciliation:read, with the
 * mandatory freshness envelope (BACKOFFICE-40).
 */

const PERIOD = '2026-05'
const finance: Principal = { subject: 'demo:finance-analyst', persona: 'finance-analyst', scopes: ['reconciliation:read', 'billing:read'] }
const care: Principal = { subject: 'demo:care', persona: 'customer-care-agent', scopes: ['consents:admin'] }

const accrual: FeeAccrual = {
  total_fee_minor: 550,
  currency: 'AED',
  by_line_type: [
    { line_type: 'lfi_access_log', total_fee_minor: 50, line_count: 1 },
    { line_type: 'payment_settlement', total_fee_minor: 500, line_count: 2 }
  ],
  source_published_at: '2026-05-28T00:00:00.000Z',
  stale: false
}

function svc(deps: Partial<ConstructorParameters<typeof FinanceViewService>[0]> = {}) {
  const margin: MarginSummary = { ...emptyMargin(), total_margin: 30, by_fintech: { 'org-1': { client_id: 'org-1', by_family: { SIP: { nebras_fee: 250, fintech_charge: 280, margin: 30 } }, total_margin: 30 } } }
  return new FinanceViewService({
    feeAccrual: { feeAccrualForPeriod: async () => accrual },
    margin: { marginForPeriod: async () => margin },
    disputes: { openNebrasDisputeCount: async () => 3 },
    unbilled: { unbilledTrafficCount: async () => 2 },
    now: () => new Date('2026-05-15T12:00:00.000Z'),
    ...deps
  })
}

describe('FinanceViewService — composition', () => {
  it('rolls up fee accrual, margin, disputes, unbilled signal + fresh freshness', async () => {
    const { data, freshness } = await svc().view(finance, PERIOD)
    expect(data.mtd_nebras_fee_accrual).toEqual({ amount: 550, currency: 'AED' })
    expect((data.fee_accrual_by_line_type as unknown[]).length).toBe(2)
    expect((data.tpp_aas_margin as MarginSummary).total_margin).toBe(30)
    expect(data.open_nebras_dispute_count).toBe(3)
    expect(data.unbilled_traffic_alert_count).toBe(2)
    expect(data.reconciliation_console_deeplink).toBe('/back-office/reconciliation/runs')
    expect(freshness.stale).toBe(false)
    expect(freshness.source_published_at).toBe('2026-05-28T00:00:00.000Z')
    expect(freshness.view_refreshed_at).toBe('2026-05-15T12:00:00.000Z')
  })

  it('UIF: emits typed sections the portal renders as bespoke panels (money in major units, no PSU PII)', async () => {
    const { data } = await svc().view(finance, PERIOD)
    const sections = data.sections as { kind: string; title: string; stats?: { label: string; value: string }[]; segments?: { label: string; value: number }[] }[]
    const byKind = (k: string) => sections.filter((s) => s.kind === k)

    const kpi = byKind('kpi-strip')[0]!
    expect(kpi.title).toBe('Finance Overview')
    expect(kpi.stats?.find((s) => s.label === 'MTD Nebras fee accrual')?.value).toBe('AED 5.50') // 550 minor → major
    expect(kpi.stats?.find((s) => s.label === 'TPP-aaS margin')?.value).toBe('AED 0.30')
    expect(kpi.stats?.find((s) => s.label === 'Open Nebras disputes')?.value).toBe('3')

    const bars = byKind('contribution-bars')
    expect(bars.map((b) => b.title)).toEqual(['Fee Accrual by Line Type', 'Margin by Product Family'])
    expect(bars[0]?.segments).toEqual([{ label: 'lfi_access_log', value: 50 }, { label: 'payment_settlement', value: 500 }])
    expect(bars[1]?.segments).toEqual([{ label: 'SIP', value: 30 }])

    expect(JSON.stringify(sections)).not.toMatch(/784|emirates|iban|psu_/i)
  })

  it('marks the view stale (amber) when the period has no ingested aggregates', async () => {
    const { data, freshness } = await svc({ feeAccrual: { feeAccrualForPeriod: async () => null } }).view(finance, PERIOD)
    expect(data.mtd_nebras_fee_accrual).toEqual({ amount: 0, currency: 'AED' })
    expect(freshness.stale).toBe(true)
    expect(freshness.stale_cause).toBe('no_ingested_aggregates_for_period')
  })

  it('propagates last-ingestion-failed staleness from the aggregates', async () => {
    const { freshness } = await svc({ feeAccrual: { feeAccrualForPeriod: async () => ({ ...accrual, stale: true }) } }).view(finance, PERIOD)
    expect(freshness.stale).toBe(true)
    expect(freshness.stale_cause).toBe('last_ingestion_failed')
  })

  it('defaults to the current month when no period is given', async () => {
    const { data } = await svc().view(finance)
    expect(data.period).toBe('2026-05')
  })

  it('rejects a malformed period (400)', async () => {
    await expect(svc().view(finance, '2026-5')).rejects.toBeInstanceOf(FinanceViewError)
  })

  it('rejects a principal without reconciliation:read (service-layer defence in depth)', async () => {
    await expect(svc().view(care, PERIOD)).rejects.toBeInstanceOf(ScopeDeniedError)
  })
})

describe('GET /back-office/analytics/finance-view (HTTP)', () => {
  const app = createApp()
  const auth = (persona: string) => ({ ...FAPI_HEADERS, authorization: `Bearer demo-token:${persona}` })

  it('returns 200 with the AnalyticsView envelope (data + freshness) for finance-analyst', async () => {
    const res = await app.request('/back-office/analytics/finance-view', { headers: auth('finance-analyst') })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Record<string, unknown>; meta: { request_id: string }; freshness: { stale: boolean } }
    expect(body.meta.request_id).toBeTruthy()
    expect(body.data.reconciliation_console_deeplink).toBe('/back-office/reconciliation/runs')
    expect(body.data).toHaveProperty('mtd_nebras_fee_accrual')
    expect(body.freshness).toHaveProperty('stale')
  })

  it('rejects a wrong-scope persona at the BFF middleware (403)', async () => {
    const res = await app.request('/back-office/analytics/finance-view', { headers: auth('customer-care-agent') })
    expect(res.status).toBe(403)
  })

  it('ignores an undeclared query parameter (always month-to-date — no contract drift)', async () => {
    // ?period is not a contract parameter; the view stays MTD and returns 200.
    const res = await app.request('/back-office/analytics/finance-view?period=nope', { headers: auth('finance-analyst') })
    expect(res.status).toBe(200)
  })
})
