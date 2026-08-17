import { divideHalfUp } from './money.js'
import type { BillingFeeClass } from './rate-card.js'
import type { PricedLine, RatingResult } from './rating.js'

/**
 * BILL-12 — the expected TPP cost statement (ADR 0007).
 *
 * What the institution should EXPECT to pay for the Open Finance services it consumed as
 * TPP-of-record, projected from its own immutable outbound metering under effective-dated rates.
 * It exists before any provider document does: it is the "expected" side of the three-way payable
 * reconciliation (BILL-15), and the thing an over-billing Hub or counterparty is checked against.
 *
 * Deliberate properties:
 *   - **Pure and deterministic.** Same rating in, byte-identical statement out; no clock, no I/O,
 *     no mutation of the rating it projects. Reproducible from the same immutable inputs.
 *   - **Net of VAT, with the two scheme treatments kept apart** (ADR 0007 D4, IG v5.0 §10.9/§10.10):
 *     Nebras Hub fees are billed VAT-EXCLUSIVE (the scheme rate is net, 5% is added), while TPP→LFI
 *     fees are VAT-INCLUSIVE (the scheme rate is gross, VAT is 5/105 of it). The accrual is the NET
 *     amount; input VAT is only recognised against a valid tax invoice (BILL-16).
 *   - **Zero PSU data.** Lines carry event ids and FAPI interaction ids for drill-down, never a PSU
 *     identifier — the cost ledger is not a place PII may reach (CLAUDE.md hard stop).
 */

export type CostRecipientType = 'nebras' | 'underlying_lfi'
export type TppCostFeeStream = 'hub' | 'lfi_payment' | 'lfi_data'
export type TppCostProductFamily = 'payments' | 'data' | 'confirmation_of_payee' | 'insurance' | 'quotes' | 'other'
export type TppCostCustomerSegment = 'retail' | 'corporate' | 'unclassified'
export type VatTreatment = 'exclusive' | 'inclusive'

/** Identifier used for the Hub itself, which is a single scheme-level counterparty. */
export const NEBRAS_COST_RECIPIENT_ID = 'NEBRAS'

export interface ExpectedTppCostEvidence {
  tenantId: string
  /** The meter run this projection was rated from. */
  meterRunId: string
  generatedAt: string
  ratingRunAt: string
  /** `effectiveFrom` of the rate card applied. */
  pricingEffectiveFrom: string
  /** Canonical hash chaining the pricing-document version and the directory snapshot. */
  rateSnapshotHash: string
  directorySnapshotId?: string
  /** Optional cost attribution per TPP-aaS client id; absent entries stay unattributed. */
  attribution?: Readonly<Record<string, { internalProduct?: string; costCentreRef?: string }>>
}

export interface ExpectedTppCostStatementLine {
  costRecipientType: CostRecipientType
  costRecipientId: string
  feeStream: TppCostFeeStream
  feeClass: BillingFeeClass
  productFamily: TppCostProductFamily
  apiFamily: string
  customerSegment: TppCostCustomerSegment
  internalProduct?: string
  costCentreRef?: string
  units: number
  events: number
  vatTreatment: VatTreatment
  expectedNetMilliFils: number
  vatMilliFils: number
  expectedGrossMilliFils: number
  eventIds: string[]
  fapiInteractionIds: string[]
}

export interface ExpectedTppCostTotals {
  nebrasHubNetMilliFils: number
  underlyingLfiPaymentNetMilliFils: number
  underlyingLfiDataNetMilliFils: number
  totalNetMilliFils: number
  totalVatMilliFils: number
  totalGrossMilliFils: number
}

export interface ExpectedTppCostStatement {
  period: string
  tenantId: string
  /** Every amount below is integer milli-fils in this currency (CLAUDE.md money convention). */
  currency: 'AED'
  rateCardVersion: string
  evidence: {
    meterRunId: string
    generatedAt: string
    ratingRunAt: string
    pricingEffectiveFrom: string
    rateSnapshotHash: string
    directorySnapshotId: string | null
  }
  lines: ExpectedTppCostStatementLine[]
  totals: ExpectedTppCostTotals
}

/** Canonical UTC form only — the statement must reproduce byte-identically. */
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
/** The shape the OpenAPI console and export contracts constrain `period` to. */
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/
const VAT_PERCENT = 5

/** Local grouping for cost attribution — not the directory's ApiFamilyType taxonomy. */
export function apiFamilyForEndpoint(endpoint: string | undefined): string {
  if (!endpoint) return 'unknown'
  const path = endpoint.includes(' ') ? endpoint.slice(endpoint.indexOf(' ') + 1) : endpoint
  const segment = path.split('/').find((part) => part.length > 0 && !part.startsWith('{'))
  return segment ?? 'unknown'
}

function productFamilyForApiFamily(apiFamily: string): TppCostProductFamily {
  if (apiFamily === 'payments') return 'payments'
  if (apiFamily === 'confirmation' || apiFamily === 'discovery') return 'confirmation_of_payee'
  if (apiFamily.includes('quote')) return 'quotes'
  if (apiFamily.includes('insurance')) return 'insurance'
  if (apiFamily === 'accounts' || apiFamily === 'parties') return 'data'
  return 'other'
}

function classify(line: PricedLine): {
  feeStream: TppCostFeeStream
  productFamily: TppCostProductFamily
  customerSegment: TppCostCustomerSegment
} {
  const apiFamily = apiFamilyForEndpoint(line.endpoint)
  if (line.side === 'payable_hub') {
    // A Hub fee has no fee-class product dimension of its own; the request it priced supplies it.
    return { feeStream: 'hub', productFamily: productFamilyForApiFamily(apiFamily), customerSegment: 'unclassified' }
  }
  if (line.feeClass.startsWith('payment.')) {
    return {
      feeStream: 'lfi_payment',
      productFamily: 'payments',
      customerSegment: line.feeClass === 'payment.corporate' ? 'corporate' : 'retail'
    }
  }
  return {
    feeStream: 'lfi_data',
    productFamily: 'data',
    customerSegment: line.feeClass === 'data.corporate_page' ? 'corporate' : 'retail'
  }
}

/**
 * VAT is applied once per aggregated statement line, not per event, so the statement carries a
 * single defensible rounding per cost dimension rather than accumulating per-call rounding drift.
 *
 * VAT direction per stream is a scheme fact, not a preference: Hub fees exclusive, TPP→LFI inclusive
 * (ADR 0007 D4). The Hub posture rests on the IG v5.0 §10.9 sample invoice and is confirmed against
 * the first real invoice under BD-20 — if that lands the other way, this is the single place to change.
 * Kept separate from invoicing.ts's `extractVatInclusiveFils` because that one works in fils and this
 * must not round through a coarser unit than the statement stores.
 */
function applyVat(amountMilliFils: number, treatment: VatTreatment): {
  expectedNetMilliFils: number
  vatMilliFils: number
  expectedGrossMilliFils: number
} {
  if (treatment === 'exclusive') {
    const vatMilliFils = divideHalfUp(amountMilliFils * VAT_PERCENT, 100)
    return { expectedNetMilliFils: amountMilliFils, vatMilliFils, expectedGrossMilliFils: amountMilliFils + vatMilliFils }
  }
  const vatMilliFils = divideHalfUp(amountMilliFils * VAT_PERCENT, 100 + VAT_PERCENT)
  return {
    expectedNetMilliFils: amountMilliFils - vatMilliFils,
    vatMilliFils,
    expectedGrossMilliFils: amountMilliFils
  }
}

function requireText(value: string | undefined, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new RangeError(`${label} is required`)
  return value
}

/** Calendar-checked, not merely shape-checked: 2026-02-31 is not a date. */
function requireCalendarDate(value: string, label: string): string {
  if (typeof value !== 'string' || !DATE.test(value)) throw new RangeError(`${label} must be YYYY-MM-DD`)
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError(`${label} is not a valid calendar date`)
  }
  return value
}

function requireTimestamp(value: string, label: string): string {
  if (typeof value !== 'string' || !ISO_DATETIME.test(value) || Number.isNaN(Date.parse(value))) {
    throw new RangeError(`${label} must be an ISO-8601 UTC timestamp`)
  }
  return value
}

interface Bucket {
  line: Omit<ExpectedTppCostStatementLine, 'expectedNetMilliFils' | 'vatMilliFils' | 'expectedGrossMilliFils'>
  amountMilliFils: number
  eventIds: Set<string>
  fapiInteractionIds: Set<string>
}

/**
 * Project a rating run into the institution's expected TPP cost statement for the period.
 *
 * Only payable sides contribute: `payable_hub` becomes the Nebras cost, `payable_lfi` the
 * underlying-LFI cost, split into its payment-execution and data-sharing streams. Receivable and
 * `free_to_lfi` lines belong to the LFI role and are deliberately absent.
 */
export function buildExpectedTppCostStatement(
  rating: RatingResult,
  evidence: ExpectedTppCostEvidence
): ExpectedTppCostStatement {
  const tenantId = requireText(evidence.tenantId, 'tenantId')
  const meterRunId = requireText(evidence.meterRunId, 'meterRunId')
  const rateSnapshotHash = requireText(evidence.rateSnapshotHash, 'rateSnapshotHash')
  const generatedAt = requireTimestamp(evidence.generatedAt, 'generatedAt')
  const ratingRunAt = requireTimestamp(evidence.ratingRunAt, 'ratingRunAt')
  const pricingEffectiveFrom = requireCalendarDate(
    requireText(evidence.pricingEffectiveFrom, 'pricingEffectiveFrom'),
    'pricingEffectiveFrom'
  )
  // `period` is the one field the OpenAPI contract constrains and the one this builder did not
  // check. BILL-13 calls it directly, at which point that pattern becomes its contract.
  if (!PERIOD.test(rating.period)) throw new RangeError('period must be YYYY-MM with a real month')

  const buckets = new Map<string, Bucket>()

  for (const priced of rating.priced) {
    if (priced.side !== 'payable_hub' && priced.side !== 'payable_lfi') continue

    const { feeStream, productFamily, customerSegment } = classify(priced)
    // Cost that cannot be attributed to an API is exactly the cost that goes unnoticed, so an
    // unattributable line fails the statement rather than pooling quietly into 'other'.
    const apiFamily = apiFamilyForEndpoint(requireText(priced.endpoint, `endpoint for ${priced.eventId}`))
    const costRecipientType: CostRecipientType = priced.side === 'payable_hub' ? 'nebras' : 'underlying_lfi'
    const costRecipientId = costRecipientType === 'nebras'
      ? NEBRAS_COST_RECIPIENT_ID
      : requireText(priced.counterpartyLfiId, `counterpartyLfiId for ${priced.eventId}`)
    const attribution = priced.clientId ? evidence.attribution?.[priced.clientId] : undefined

    const key = [
      costRecipientType,
      costRecipientId,
      feeStream,
      priced.feeClass,
      productFamily,
      apiFamily,
      customerSegment,
      attribution?.internalProduct ?? '',
      attribution?.costCentreRef ?? ''
    ].join('|')

    const bucket = buckets.get(key) ?? {
      line: {
        costRecipientType,
        costRecipientId,
        feeStream,
        feeClass: priced.feeClass,
        productFamily,
        apiFamily,
        customerSegment,
        ...(attribution?.internalProduct ? { internalProduct: attribution.internalProduct } : {}),
        ...(attribution?.costCentreRef ? { costCentreRef: attribution.costCentreRef } : {}),
        units: 0,
        events: 0,
        vatTreatment: (costRecipientType === 'nebras' ? 'exclusive' : 'inclusive') as VatTreatment,
        eventIds: [],
        fapiInteractionIds: []
      },
      amountMilliFils: 0,
      eventIds: new Set<string>(),
      fapiInteractionIds: new Set<string>()
    }

    bucket.line.units += priced.units
    bucket.line.events += 1
    bucket.amountMilliFils += priced.amountMilliFils
    bucket.eventIds.add(priced.eventId)
    if (priced.traceId) bucket.fapiInteractionIds.add(priced.traceId)
    buckets.set(key, bucket)
  }

  const lines: ExpectedTppCostStatementLine[] = [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, bucket]) => ({
      ...bucket.line,
      ...applyVat(bucket.amountMilliFils, bucket.line.vatTreatment),
      eventIds: [...bucket.eventIds].sort(),
      fapiInteractionIds: [...bucket.fapiInteractionIds].sort()
    }))

  const sum = (predicate: (line: ExpectedTppCostStatementLine) => boolean): number =>
    lines.filter(predicate).reduce((total, line) => total + line.expectedNetMilliFils, 0)

  const totals: ExpectedTppCostTotals = {
    nebrasHubNetMilliFils: sum((line) => line.feeStream === 'hub'),
    underlyingLfiPaymentNetMilliFils: sum((line) => line.feeStream === 'lfi_payment'),
    underlyingLfiDataNetMilliFils: sum((line) => line.feeStream === 'lfi_data'),
    totalNetMilliFils: lines.reduce((total, line) => total + line.expectedNetMilliFils, 0),
    totalVatMilliFils: lines.reduce((total, line) => total + line.vatMilliFils, 0),
    totalGrossMilliFils: lines.reduce((total, line) => total + line.expectedGrossMilliFils, 0)
  }

  return {
    period: rating.period,
    tenantId,
    currency: 'AED',
    rateCardVersion: rating.rateCardVersion,
    evidence: {
      meterRunId,
      generatedAt,
      ratingRunAt,
      pricingEffectiveFrom,
      rateSnapshotHash,
      directorySnapshotId: evidence.directorySnapshotId ?? null
    },
    lines,
    totals
  }
}
