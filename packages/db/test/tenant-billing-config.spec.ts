import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TENANT_CONFIGURATION,
  normalizeTenantConfiguration,
  type TenantConfigurationInput
} from '../src/index.js'

describe('HOST-01 / BILL-10 tenant configuration', () => {
  it('preserves PRD defaults and normalizes tenant billing overlays without shared mutation', () => {
    const alpha = normalizeTenantConfiguration({ bankId: '11111111-1111-4111-8111-111111111111' })
    const beta = normalizeTenantConfiguration({
      bankId: '22222222-2222-4222-8222-222222222222', approvalExpiryBusinessHours: 4,
      yearAnchorDate: '2026-01-01', retailOverageMilliFils: 8_000,
      invoiceTemplateRef: 'pint-ae:beta:v2', invoiceBrandKey: 'emerald',
      aspRouteProfile: 'asp-beta', collectionRailPolicy: { preferred: 'aani_request_to_pay', fallback: 'uaedds' }
    })

    expect(alpha).toMatchObject(DEFAULT_TENANT_CONFIGURATION)
    expect(beta).toMatchObject({ approvalExpiryBusinessHours: 4, yearAnchorDate: '2026-01-01', retailOverageMilliFils: 8_000, aspRouteProfile: 'asp-beta' })
    expect(alpha.invoiceTemplateRef).not.toBe(beta.invoiceTemplateRef)
    expect(DEFAULT_TENANT_CONFIGURATION.collectionRailPolicy).toEqual({ preferred: 'scheme_net_settlement', fallback: 'uaedds' })
  })

  it('fails closed on invalid tenant, dates, money, and mutable policy aliases', () => {
    const bad = (patch: Partial<TenantConfigurationInput>) => () => normalizeTenantConfiguration({ bankId: '11111111-1111-4111-8111-111111111111', ...patch })
    expect(bad({ bankId: 'not-a-uuid' })).toThrow(/bankId/)
    expect(bad({ yearAnchorDate: '2026-1-1' })).toThrow(/yearAnchorDate/)
    expect(bad({ retailOverageMilliFils: -1 })).toThrow(/retailOverage/)
    expect(bad({ approvalExpiryBusinessHours: 0 })).toThrow(/approvalExpiry/)
  })
})
