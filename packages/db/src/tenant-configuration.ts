export type TenantCollectionRail = 'scheme_net_settlement' | 'of_invoice_collection' | 'aani_request_to_pay' | 'uaedds'

export interface TenantCollectionRailPolicy {
  preferred: TenantCollectionRail
  fallback: TenantCollectionRail
}

export interface TenantConfigurationInput {
  bankId: string
  approvalExpiryBusinessHours?: number
  slaWeekendPause?: boolean
  fraudRevokeFourEyes?: boolean
  careSurfaceResidency?: 'portal' | 'enterprise'
  yearAnchorDate?: string
  retailOverageMilliFils?: number | null
  invoiceTemplateRef?: string
  invoiceBrandKey?: string
  aspRouteProfile?: string
  collectionRailPolicy?: TenantCollectionRailPolicy
}

export interface TenantConfiguration {
  bankId: string
  approvalExpiryBusinessHours: number
  slaWeekendPause: boolean
  fraudRevokeFourEyes: boolean
  careSurfaceResidency: 'portal' | 'enterprise'
  yearAnchorDate: string
  retailOverageMilliFils: number | null
  invoiceTemplateRef: string
  invoiceBrandKey: string
  aspRouteProfile: string
  collectionRailPolicy: TenantCollectionRailPolicy
}

export const DEFAULT_TENANT_CONFIGURATION = Object.freeze({
  approvalExpiryBusinessHours: 2,
  slaWeekendPause: true,
  fraudRevokeFourEyes: true,
  careSurfaceResidency: 'portal' as const,
  yearAnchorDate: '2025-10-01',
  retailOverageMilliFils: null,
  invoiceTemplateRef: 'pint-ae:default:v1',
  invoiceBrandKey: 'institutional-default',
  aspRouteProfile: 'default',
  collectionRailPolicy: Object.freeze({ preferred: 'scheme_net_settlement' as const, fallback: 'uaedds' as const })
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const RAILS = new Set<TenantCollectionRail>(['scheme_net_settlement', 'of_invoice_collection', 'aani_request_to_pay', 'uaedds'])

function nonEmpty(value: string, label: string): string {
  if (!value.trim()) throw new RangeError(`${label} cannot be empty`)
  return value
}

export function normalizeTenantConfiguration(input: TenantConfigurationInput): TenantConfiguration {
  if (!UUID.test(input.bankId)) throw new RangeError('bankId must be a UUID')
  const approvalExpiryBusinessHours = input.approvalExpiryBusinessHours ?? DEFAULT_TENANT_CONFIGURATION.approvalExpiryBusinessHours
  if (!Number.isInteger(approvalExpiryBusinessHours) || approvalExpiryBusinessHours < 1 || approvalExpiryBusinessHours > 24) {
    throw new RangeError('approvalExpiryBusinessHours must be an integer from 1 to 24')
  }
  const yearAnchorDate = input.yearAnchorDate ?? DEFAULT_TENANT_CONFIGURATION.yearAnchorDate
  if (!DATE.test(yearAnchorDate) || Number.isNaN(Date.parse(`${yearAnchorDate}T00:00:00.000Z`))) {
    throw new RangeError('yearAnchorDate must be a valid YYYY-MM-DD date')
  }
  const retailOverageMilliFils = input.retailOverageMilliFils ?? DEFAULT_TENANT_CONFIGURATION.retailOverageMilliFils
  if (retailOverageMilliFils !== null && (!Number.isSafeInteger(retailOverageMilliFils) || retailOverageMilliFils < 0)) {
    throw new RangeError('retailOverageMilliFils must be null or a non-negative safe integer')
  }
  const collectionRailPolicy = { ...(input.collectionRailPolicy ?? DEFAULT_TENANT_CONFIGURATION.collectionRailPolicy) }
  if (!RAILS.has(collectionRailPolicy.preferred) || !RAILS.has(collectionRailPolicy.fallback)) {
    throw new RangeError('collectionRailPolicy contains an unsupported rail')
  }
  return Object.freeze({
    bankId: input.bankId,
    approvalExpiryBusinessHours,
    slaWeekendPause: input.slaWeekendPause ?? DEFAULT_TENANT_CONFIGURATION.slaWeekendPause,
    fraudRevokeFourEyes: input.fraudRevokeFourEyes ?? DEFAULT_TENANT_CONFIGURATION.fraudRevokeFourEyes,
    careSurfaceResidency: input.careSurfaceResidency ?? DEFAULT_TENANT_CONFIGURATION.careSurfaceResidency,
    yearAnchorDate,
    retailOverageMilliFils,
    invoiceTemplateRef: nonEmpty(input.invoiceTemplateRef ?? DEFAULT_TENANT_CONFIGURATION.invoiceTemplateRef, 'invoiceTemplateRef'),
    invoiceBrandKey: nonEmpty(input.invoiceBrandKey ?? DEFAULT_TENANT_CONFIGURATION.invoiceBrandKey, 'invoiceBrandKey'),
    aspRouteProfile: nonEmpty(input.aspRouteProfile ?? DEFAULT_TENANT_CONFIGURATION.aspRouteProfile, 'aspRouteProfile'),
    collectionRailPolicy: Object.freeze(collectionRailPolicy)
  })
}
