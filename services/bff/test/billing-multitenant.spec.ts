import { describe, expect, it } from 'vitest'
import { fils, SCHEME_RATE_CARD_2026_06_02 } from '@ofbo/billing'
import { normalizeTenantConfiguration, type TenantConfiguration } from '@ofbo/db'
import { BillingTenantService, InMemoryTenantConfigurationReader } from '../src/billing/tenant-service.js'

const ALPHA = '11111111-1111-4111-8111-111111111111'
const BETA = '22222222-2222-4222-8222-222222222222'

function config(bankId: string, patch: Partial<TenantConfiguration>): TenantConfiguration {
  return normalizeTenantConfiguration({ bankId, ...patch })
}

describe('BILL-10 multi-tenant billing profile', () => {
  it('applies distinct year anchors, overage rates, invoice branding, ASP routes, and collection policies', async () => {
    const reader = new InMemoryTenantConfigurationReader([
      config(ALPHA, { yearAnchorDate: '2025-10-01', retailOverageMilliFils: fils(950), invoiceTemplateRef: 'pint-ae:alpha:v1', invoiceBrandKey: 'indigo', aspRouteProfile: 'asp-alpha' }),
      config(BETA, { yearAnchorDate: '2026-01-01', retailOverageMilliFils: fils(800), invoiceTemplateRef: 'pint-ae:beta:v2', invoiceBrandKey: 'emerald', aspRouteProfile: 'asp-beta', collectionRailPolicy: { preferred: 'aani_request_to_pay', fallback: 'uaedds' } })
    ])
    const service = new BillingTenantService({ configurations: reader })

    const alpha = await service.profile(ALPHA, SCHEME_RATE_CARD_2026_06_02)
    const beta = await service.profile(BETA, SCHEME_RATE_CARD_2026_06_02)
    expect(alpha.rateCard.yearAnchor.date).toBe('2025-10-01')
    expect(beta.rateCard.yearAnchor.date).toBe('2026-01-01')
    expect(alpha.rateCard.receivable['data.retail_page'].overageMilliFils).toBe(fils(950))
    expect(beta.rateCard.receivable['data.retail_page'].overageMilliFils).toBe(fils(800))
    expect(alpha.invoice).toEqual({ templateRef: 'pint-ae:alpha:v1', brandKey: 'indigo' })
    expect(beta.aspRouteProfile).toBe('asp-beta')
    expect(beta.collectionRailPolicy.preferred).toBe('aani_request_to_pay')
    expect(SCHEME_RATE_CARD_2026_06_02.yearAnchor.date).toBe('2025-10-01')
  })

  it('treats an unpublished directory overage rate as zero rather than inheriting another tenant rate', async () => {
    const reader = new InMemoryTenantConfigurationReader([config(BETA, { retailOverageMilliFils: null })])
    const profile = await new BillingTenantService({ configurations: reader }).profile(BETA, SCHEME_RATE_CARD_2026_06_02)
    expect(profile.rateCard.receivable['data.retail_page'].overageMilliFils).toBe(0)
  })

  it('fails closed for an unprovisioned tenant', async () => {
    const service = new BillingTenantService({ configurations: new InMemoryTenantConfigurationReader() })
    await expect(service.profile(ALPHA, SCHEME_RATE_CARD_2026_06_02)).rejects.toThrow(/not provisioned/)
  })
})
