import { aed, fils } from './money.js'

export type BillingSide = 'receivable' | 'payable_hub' | 'payable_lfi' | 'free_to_lfi'

interface RateBase {
  label: string
  cite: string
}

export interface FlatRate extends RateBase {
  basis: 'flat'
  flatMilliFils: number
  batchCapMilliFils?: number
  thresholdMilliFils?: number
  windowHours?: number
}

export interface BasisPointRate extends RateBase {
  basis: 'bps_of_value'
  scheduleBasisPoints: number[]
  capMilliFils: number
  freeAllowance: {
    per: 'merchant_per_day'
    valueMilliFils: number
    requires: 'merchant_id_present'
    since: string
  }
}

export interface SteppedFlatRate extends RateBase {
  basis: 'flat_stepped'
  scheduleMilliFils: number[]
}

export interface PageRate extends RateBase {
  basis: 'per_page'
  flatMilliFils: number
}

export interface RetailPageRate extends RateBase {
  basis: 'per_page_over_free_tier'
  freeTier: { attended: number; unattended: number; per: 'psu_per_day' }
  overageMilliFils: number
  overageSource: string
}

export interface TieredProviderRate extends RateBase {
  basis: 'tiered_by_providers'
  tiers: Array<{ maxProviders: number | null; milliFils: number }>
}

export interface ReceivableRates {
  'payment.merchant_collection': BasisPointRate
  'payment.p2p_sme': FlatRate
  'payment.me_to_me': SteppedFlatRate
  'payment.sme_bulk': FlatRate
  'payment.large_value': FlatRate
  'payment.corporate': FlatRate
  'data.corporate_page': PageRate
  'data.retail_page': RetailPageRate
}

export interface HubRates {
  'hub.standard': FlatRate
  'hub.paired': FlatRate
  'hub.quote': TieredProviderRate
}

export type ReceivableFeeClass = keyof ReceivableRates
export type HubFeeClass = keyof HubRates
export type BillingFeeClass = ReceivableFeeClass | HubFeeClass | 'no_lfi_charge'

export type ReconciliationFeeClass =
  | 'payment_settlement'
  | 'consent_record'
  | 'lfi_access_log'
  | 'tpp_aas_pass_through'
  | 'dao_api_call'

export interface RateCard {
  version: string
  label: string
  effectiveFrom: string
  source: string
  currency: 'AED'
  yearAnchor: {
    date: string
    status: 'ASSUMED' | 'CONFIRMED'
    note: string
  }
  receivable: ReceivableRates
  payableHub: HubRates
  reconciliationUnitRates: Record<ReconciliationFeeClass, { milliFils: number; cite: string }>
  chargeableEndpoints: Record<string, EndpointChargeKind>
  freeEndpoints: string[]
}

export type EndpointChargeKind = 'payment' | 'data' | 'data_pairable' | 'cop_pairable' | 'quote' | 'hub_only' | 'reporting'

/** Community mirror of the scheme's v2.1 50-endpoint chargeable table, checked 12 Aug 2026. */
export const SCHEME_CHARGEABLE_ENDPOINTS_V2_1: Readonly<Record<string, EndpointChargeKind>> = deepFreeze({
  'GET /accounts': 'data',
  'GET /accounts/{AccountId}': 'data',
  'GET /accounts/{AccountId}/balances': 'data_pairable',
  'GET /accounts/{AccountId}/beneficiaries': 'data',
  'GET /accounts/{AccountId}/direct-debits': 'data',
  'GET /accounts/{AccountId}/parties': 'data',
  'GET /accounts/{AccountId}/product': 'data',
  'GET /accounts/{AccountId}/scheduled-payments': 'data',
  'GET /accounts/{AccountId}/standing-orders': 'data',
  'GET /accounts/{AccountId}/statements': 'data',
  'GET /accounts/{AccountId}/transactions': 'data',
  'GET /employment-insurance-policies': 'hub_only',
  'GET /employment-insurance-policies/{InsurancePolicyId}': 'hub_only',
  'GET /health-insurance-policies': 'hub_only',
  'GET /health-insurance-policies/{InsurancePolicyId}': 'hub_only',
  'GET /home-insurance-policies': 'hub_only',
  'GET /home-insurance-policies/{InsurancePolicyId}': 'hub_only',
  'GET /life-insurance-policies': 'hub_only',
  'GET /life-insurance-policies/{InsurancePolicyId}': 'hub_only',
  'GET /motor-insurance-policies': 'hub_only',
  'GET /motor-insurance-policies/{InsurancePolicyId}': 'hub_only',
  'GET /parties': 'data',
  'GET /renters-insurance-policies': 'hub_only',
  'GET /renters-insurance-policies/{InsurancePolicyId}': 'hub_only',
  'GET /travel-insurance-policies': 'hub_only',
  'GET /travel-insurance-policies/{InsurancePolicyId}': 'hub_only',
  'GET /payment-consents/{ConsentId}/refund': 'hub_only',
  'POST /payments': 'payment',
  'POST /employment-insurance-policies': 'hub_only',
  'POST /employment-insurance-quotes': 'quote',
  'PATCH /employment-insurance-quotes/{QuoteId}': 'hub_only',
  'POST /health-insurance-policies': 'hub_only',
  'POST /health-insurance-quotes': 'quote',
  'PATCH /health-insurance-quotes/{QuoteId}': 'hub_only',
  'POST /home-insurance-policies': 'hub_only',
  'POST /home-insurance-quotes': 'quote',
  'PATCH /home-insurance-quotes/{QuoteId}': 'hub_only',
  'POST /life-insurance-policies': 'hub_only',
  'POST /life-insurance-quotes': 'quote',
  'PATCH /life-insurance-quotes/{QuoteId}': 'hub_only',
  'POST /motor-insurance-policies': 'hub_only',
  'POST /motor-insurance-quotes': 'quote',
  'PATCH /motor-insurance-quotes/{QuoteId}': 'hub_only',
  'POST /renters-insurance-policies': 'hub_only',
  'POST /renters-insurance-quotes': 'quote',
  'PATCH /renters-insurance-quotes/{QuoteId}': 'hub_only',
  'POST /travel-insurance-policies': 'hub_only',
  'POST /travel-insurance-quotes': 'quote',
  'PATCH /travel-insurance-quotes/{QuoteId}': 'hub_only',
  'POST /confirmation': 'cop_pairable'
})

/** Community mirror of the scheme's v2.1 26-endpoint non-chargeable table. */
export const SCHEME_FREE_ENDPOINTS_V2_1: readonly string[] = deepFreeze([
  'GET /account-access-consents',
  'GET /account-access-consents/{ConsentId}',
  'PATCH /account-access-consents/{ConsentId}',
  'GET /insurance-consents',
  'GET /insurance-consents/{ConsentId}',
  'PATCH /insurance-consents/{ConsentId}',
  'POST /par',
  'GET /payment-consents',
  'GET /payment-consents/{ConsentId}',
  'PATCH /payment-consents/{ConsentId}',
  'POST /token',
  'GET /payments',
  'GET /payments/{PaymentId}',
  'GET /employment-insurance-quotes/{QuoteId}',
  'GET /health-insurance-quotes/{QuoteId}',
  'GET /home-insurance-quotes/{QuoteId}',
  'GET /life-insurance-quotes/{QuoteId}',
  'GET /motor-insurance-quotes/{QuoteId}',
  'GET /renters-insurance-quotes/{QuoteId}',
  'GET /travel-insurance-quotes/{QuoteId}',
  'POST /discovery',
  'GET /atms',
  'POST /leads',
  'GET /products',
  'GET /participants',
  'POST /tpp-registration'
])

export interface RateCardDiff {
  path: string
  before: unknown
  after: unknown
}

export interface TenantBillingConfig {
  tenantId: string
  yearAnchorDate: string
  retailOverageMilliFils?: number
}

export interface TenantRateCard extends RateCard {
  tenantId: string
}

export const RATE_CARD_CHANGE_NOTIFY = ['Finance', 'Compliance'] as const

export interface RateCardChangeReview {
  reviewKey: string
  classification: 'High'
  requiresApproval: true
  autoApply: false
  notify: typeof RATE_CARD_CHANGE_NOTIFY
  beforeVersion: string
  afterVersion: string
  effectiveFrom: string
  changes: RateCardDiff[]
}

export interface UpstreamSnapshot {
  sourceUrl: string
  contentHash: string
  capturedAt: string
}

export interface UpstreamChangeDecision {
  changed: boolean
  requiresReview: boolean
  autoApply: false
  sourceUrl: string
  previousHash: string
  currentHash: string
  detectedAt: string
  reviewTask: {
    type: 'RATE_CARD_UPSTREAM_REVIEW'
    classification: 'High'
    status: 'OPEN'
    notify: typeof RATE_CARD_CHANGE_NOTIFY
  } | null
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

export const SCHEME_RATE_CARD_2026_06_02: RateCard = deepFreeze({
  version: '2026.06.02',
  label: 'CBUAE Commercial & Pricing Model — page state 2 Jun 2026',
  effectiveFrom: '2026-06-02',
  source: 'https://openfinanceuae.atlassian.net/wiki/spaces/OF/pages/124846096/Commercial+and+Pricing+Model',
  currency: 'AED',
  yearAnchor: {
    date: '2025-10-01',
    status: 'ASSUMED',
    note: 'Scheme has not published the Year-1 anchor. Tenant-configurable; every stepped fee depends on it.'
  },
  receivable: {
    'payment.merchant_collection': {
      label: 'Merchant collections',
      basis: 'bps_of_value',
      scheduleBasisPoints: [38, 35, 32, 29, 25],
      capMilliFils: aed(50),
      freeAllowance: {
        per: 'merchant_per_day',
        valueMilliFils: aed(200),
        requires: 'merchant_id_present',
        since: '2026-06-02'
      },
      cite: 'C&P §Open Banking — Service Initiation (Retail & SME)'
    },
    'payment.p2p_sme': { label: 'P2P / SME-to-SME', basis: 'flat', flatMilliFils: fils(25), cite: 'C&P §Service Initiation' },
    'payment.me_to_me': { label: 'Me-to-me', basis: 'flat_stepped', scheduleMilliFils: [fils(20), fils(18), fils(17)], cite: 'C&P §Service Initiation' },
    'payment.sme_bulk': { label: 'SME bulk / batch', basis: 'flat', flatMilliFils: fils(25), batchCapMilliFils: fils(250), cite: 'C&P §Service Initiation — no limit on tx per batch' },
    'payment.large_value': { label: 'Large value / rent / invoice collection', basis: 'flat', flatMilliFils: aed(4), thresholdMilliFils: aed(5_000), cite: 'C&P §Service Initiation — embedded payment link > AED 5,000' },
    'payment.corporate': { label: 'Corporate payments (incl. bulk)', basis: 'flat', flatMilliFils: fils(250), cite: 'C&P §Service Initiation (Corporate)' },
    'data.corporate_page': { label: 'Corporate data sharing', basis: 'per_page', flatMilliFils: fils(40), cite: 'C&P §Data Sharing (Corporate) — page = 100 lines' },
    'data.retail_page': {
      label: 'Retail data sharing (overage)',
      basis: 'per_page_over_free_tier',
      freeTier: { attended: 15, unattended: 5, per: 'psu_per_day' },
      overageMilliFils: fils(950),
      overageSource: 'directory ApiMetadata.OverLimitFees (tenant-published)',
      cite: 'C&P §Data Sharing (Retail & SME)'
    }
  },
  payableHub: {
    'hub.standard': { label: 'API Hub call', basis: 'flat', flatMilliFils: fils(2.5), cite: 'C&P §API Hub Fees' },
    'hub.paired': { label: 'API Hub call — balance/CoP paired with a payment', basis: 'flat', flatMilliFils: fils(0.5), windowHours: 2, cite: 'C&P §API Hub Fees — one balance AND one CoP per payment' },
    'hub.quote': {
      label: 'API Hub quote creation (tiered)',
      basis: 'tiered_by_providers',
      tiers: [
        { maxProviders: 4, milliFils: fils(5) },
        { maxProviders: 10, milliFils: fils(7.5) },
        { maxProviders: 25, milliFils: fils(10) },
        { maxProviders: null, milliFils: fils(12.5) }
      ],
      cite: 'C&P §Quotes API Fees'
    }
  },
  reconciliationUnitRates: {
    payment_settlement: { milliFils: fils(2.5), cite: 'C&P §API Hub Fees — payment initiation' },
    consent_record: { milliFils: fils(0.5), cite: 'C&P §API Hub Fees — balance / CoP paired with payment' },
    lfi_access_log: { milliFils: fils(0.025), cite: 'C&P §Data Sharing — 2.5 fils per 100 lines' },
    tpp_aas_pass_through: { milliFils: fils(0.025), cite: 'C&P §Data Sharing — pass-through to consuming TPP' },
    dao_api_call: { milliFils: fils(0.025), cite: 'BACKOFFICE-68 default pending observed DAO volumes' }
  },
  chargeableEndpoints: {
    ...SCHEME_CHARGEABLE_ENDPOINTS_V2_1,
    // Gateway adapters may emit the existing normalized {id} templates.
    'GET /accounts/{id}/transactions': 'data',
    'GET /accounts/{id}/balances': 'data_pairable',
    'GET /accounts/{id}/statements': 'data',
    'GET /tpp-reports': 'reporting'
  },
  freeEndpoints: [
    ...SCHEME_FREE_ENDPOINTS_V2_1,
    // Existing normalized gateway templates retained as aliases.
    'GET /payments/{id}',
    'PATCH /account-access-consents/{id}',
    'GET /account-access-consents/{id}',
  ]
})

function parseIsoDate(date: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError(`${label} must be YYYY-MM-DD`)
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new RangeError(`${label} is not a valid calendar date`)
  }
  return parsed
}

/** Which calendar-anniversary year of the card's anchor is in force. */
export function yearStep(card: RateCard, date: string): number {
  const anchor = parseIsoDate(card.yearAnchor.date, 'year anchor')
  const current = parseIsoDate(date, 'rating date')
  let completedAnniversaries = current.getUTCFullYear() - anchor.getUTCFullYear()
  const anniversary = new Date(Date.UTC(current.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()))
  if (current < anniversary) completedAnniversaries -= 1
  return Math.max(1, completedAnniversaries + 1)
}

export function steppedValue(schedule: readonly number[], step: number): number {
  if (schedule.length === 0) throw new RangeError('stepped schedule cannot be empty')
  if (!Number.isInteger(step) || step < 1) throw new RangeError('step must be a positive integer')
  return schedule[Math.min(step, schedule.length) - 1] as number
}

export function rateCardAt(cards: readonly RateCard[], date: string): RateCard {
  parseIsoDate(date, 'selection date')
  const selected = [...cards]
    .filter((card) => {
      parseIsoDate(card.effectiveFrom, `rate card ${card.version} effectiveFrom`)
      return card.effectiveFrom <= date
    })
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0]
  if (!selected) throw new Error(`No rate card is effective on ${date}`)
  return selected
}

/** Apply the two scheme values that vary per institution without mutating the base card. */
export function rateCardForTenant(card: RateCard, config: TenantBillingConfig): TenantRateCard {
  if (config.tenantId.trim() === '') throw new RangeError('tenantId cannot be empty')
  parseIsoDate(config.yearAnchorDate, 'tenant year anchor')
  if (config.retailOverageMilliFils !== undefined &&
      (!Number.isSafeInteger(config.retailOverageMilliFils) || config.retailOverageMilliFils < 0)) {
    throw new RangeError('retailOverageMilliFils must be a non-negative safe integer')
  }

  const tenantCard = structuredClone(card) as TenantRateCard
  tenantCard.tenantId = config.tenantId
  tenantCard.yearAnchor.date = config.yearAnchorDate
  if (config.retailOverageMilliFils !== undefined) {
    tenantCard.receivable['data.retail_page'].overageMilliFils = config.retailOverageMilliFils
  }
  return deepFreeze(tenantCard)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function diffRateCards(before: RateCard, after: RateCard): RateCardDiff[] {
  const changes: RateCardDiff[] = []

  function walk(left: unknown, right: unknown, path: string): void {
    if (Object.is(left, right)) return
    if (isPlainObject(left) && isPlainObject(right)) {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)])
      for (const key of [...keys].sort()) walk(left[key], right[key], path ? `${path}.${key}` : key)
      return
    }
    if (Array.isArray(left) && Array.isArray(right)) {
      const length = Math.max(left.length, right.length)
      for (let index = 0; index < length; index += 1) walk(left[index], right[index], `${path}.${index}`)
      return
    }
    changes.push({ path, before: left, after: right })
  }

  walk(before, after, '')
  return changes
}

/** Build the mandatory High-class audit/review envelope for a proposed card version. */
export function prepareRateCardChangeReview(before: RateCard, after: RateCard): RateCardChangeReview {
  parseIsoDate(after.effectiveFrom, 'new rate card effectiveFrom')
  const changes = diffRateCards(before, after)
  if (changes.length === 0) throw new Error('rate-card review requires at least one change')
  if (before.version === after.version) throw new Error('rate-card changes require a new version')
  return {
    reviewKey: `rate-card:${before.version}->${after.version}`,
    classification: 'High',
    requiresApproval: true,
    autoApply: false,
    notify: RATE_CARD_CHANGE_NOTIFY,
    beforeVersion: before.version,
    afterVersion: after.version,
    effectiveFrom: after.effectiveFrom,
    changes
  }
}

/** Pure watcher decision: changed upstream content always requires human review. */
export function detectUpstreamChange(previous: UpstreamSnapshot, current: UpstreamSnapshot): UpstreamChangeDecision {
  if (previous.sourceUrl !== current.sourceUrl) throw new Error('upstream snapshots must refer to the same source URL')
  const changed = previous.contentHash !== current.contentHash
  return {
    changed,
    requiresReview: changed,
    autoApply: false,
    sourceUrl: current.sourceUrl,
    previousHash: previous.contentHash,
    currentHash: current.contentHash,
    detectedAt: current.capturedAt,
    reviewTask: changed
      ? {
          type: 'RATE_CARD_UPSTREAM_REVIEW',
          classification: 'High',
          status: 'OPEN',
          notify: RATE_CARD_CHANGE_NOTIFY
        }
      : null
  }
}
