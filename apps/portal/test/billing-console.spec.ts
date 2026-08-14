import { describe, expect, it, vi } from 'vitest'
import {
  BillingConsoleApiError,
  formatMilliFils,
  generateCbuaeFeeReview,
  getBillingConsole,
  getPortableBillingExport,
  simulateProfitability,
  type BillingScenario
} from '../src/lib/billing-console.js'

const BASE = 'http://bff.test'
const TOKEN = 'demo-token:finance-analyst@alpha-bank'
const scenario: BillingScenario = {
  scenario_id: 'directory-overage',
  effective_date: '2026-10-01',
  receivable_multiplier_basis_points: 10_500,
  retail_overage: {
    overage_units: 120,
    current_rate_milli_fils: 0,
    proposed_rate_milli_fils: 50_000
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('billing console client — BILL-09/BILL-10', () => {
  it('loads the tenant-scoped console period with the binding FAPI headers', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => json({
      data: { bank_id: 'bank-alpha', period: '2026-07', insurance: { status: 'deferred', dependency: 'approved insurance commercial model', story: 'BILL-06' } },
      freshness: { view_refreshed_at: '2026-08-13T12:00:00Z', stale: false, stale_cause: null }
    }))

    const view = await getBillingConsole(TOKEN, '2026-07', { baseUrl: BASE, fetchImpl, traceId: 'trace-console' })

    expect(view.data.period).toBe('2026-07')
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/back-office/billing/console?period=2026-07`, {
      headers: { authorization: `Bearer ${TOKEN}`, 'x-fapi-interaction-id': 'trace-console' }
    })
  })

  it('runs a pure profitability scenario with a stable idempotency key', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => json({ data: { scenario_id: scenario.scenario_id, delta_profit_milli_fils: 4_500_000 } }))

    const result = await simulateProfitability(TOKEN, { period: '2026-07', scenario }, 'sim-key', {
      baseUrl: BASE,
      fetchImpl,
      traceId: 'trace-sim'
    })

    expect(result.delta_profit_milli_fils).toBe(4_500_000)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(`${BASE}/back-office/billing/profitability:simulate`)
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'x-fapi-interaction-id': 'trace-sim',
        'idempotency-key': 'sim-key',
        'content-type': 'application/json'
      }
    })
    expect(JSON.parse(String(init!.body))).toEqual({ period: '2026-07', scenario })
  })

  it('generates the audited CBUAE artifact and tenant portability export', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes('cbuae-fee-review')
        ? json({ data: { schema_version: 'ofbo.cbuae-fee-review.v1', period: '2026-07', sha256: 'sha256:review' } })
        : json({ data: { schema_version: 'ofbo.billing-export.v1', bank_id: 'bank-alpha', sha256: 'sha256:portable' } })
    )

    const review = await generateCbuaeFeeReview(TOKEN, { period: '2026-07', scenarios: [scenario] }, 'review-key', { baseUrl: BASE, fetchImpl, traceId: 'trace-review' })
    const portable = await getPortableBillingExport(TOKEN, { baseUrl: BASE, fetchImpl, traceId: 'trace-portable' })

    expect(review.sha256).toBe('sha256:review')
    expect(portable.sha256).toBe('sha256:portable')
    expect(fetchImpl.mock.calls[0]![0]).toBe(`${BASE}/back-office/billing/exports:cbuae-fee-review`)
    expect(fetchImpl.mock.calls[1]![0]).toBe(`${BASE}/back-office/billing/export`)
  })

  it('maps the standard error envelope to an actionable typed error', async () => {
    const fetchImpl = vi.fn(async () => json({ error: {
      code: 'BACKOFFICE.BILLING_TENANT_NOT_PROVISIONED',
      message: 'Tenant is not provisioned.',
      remediation: 'Provision billing configuration.',
      docs_url: 'https://docs.ofbo/billing'
    } }, 503))

    await expect(getBillingConsole(TOKEN, '2026-07', { baseUrl: BASE, fetchImpl })).rejects.toMatchObject({
      code: 'BACKOFFICE.BILLING_TENANT_NOT_PROVISIONED',
      status: 503,
      remediation: 'Provision billing configuration.',
      docsUrl: 'https://docs.ofbo/billing'
    } satisfies Partial<BillingConsoleApiError>)
  })
})

describe('billing money presentation', () => {
  it('renders signed integer milli-fils as AED without treating them as minor units', () => {
    expect(formatMilliFils(145_000_000)).toBe('AED 1,450.00')
    expect(formatMilliFils(-4_500_000)).toBe('−AED 45.00')
    expect(formatMilliFils(null)).toBe('—')
  })
})
