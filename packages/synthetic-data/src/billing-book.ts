import { rateUsage, type MeteredLine } from '@ofbo/billing'
import { SCHEME_RATE_CARD_2026_06_02, aed, type RateCard } from '@ofbo/billing'

/**
 * The demo's book of business — what each consuming TPP actually does with Alpha Bank's Open
 * Finance APIs in a month, and what that costs them.
 *
 * WHY THIS EXISTS. The registry's fee accruals used to be hand-written round numbers
 * (`500000 + i * 137000`, `pick.int(1, 500)`), which produced two problems a demo cannot
 * survive. The numbers did not correspond to anything — no volume explained them, so "why is
 * Tabby AED 31,250?" had no answer. And because only the later-seeded institutions were given
 * accruals at all, the recognisable UAE names (Lean, Tabby, Tarabut) showed a dash while the
 * invented ones carried all the revenue. The credible half of the registry looked inert.
 *
 * HOW IT WORKS. Each TPP gets a PROFILE — a monthly volume shape that matches what that kind of
 * business actually does. Those volumes become `MeteredLine[]` and are priced by
 * `rateUsage()`, the SAME function that would bill a real month, against the SAME published rate
 * card (`SCHEME_RATE_CARD_2026_06_02`, C&P model page state 2 Jun 2026).
 *
 * Nothing here invents a price. Change the rate card and these figures move with it; break the
 * rating engine and the demo book breaks in the same direction as production. The volumes are
 * the only fiction, and they are stated in business terms a reviewer can argue with — "Lean polls
 * 62,000 attended pages a month across 3,100 PSUs" is checkable in a way that AED 31,250 is not.
 *
 * DETERMINISTIC. No RNG: the same period yields the same book, so screenshots, contract tests and
 * the hosted demo agree. Volumes vary by period through fixed indices, not a draw.
 *
 * ZERO PII by construction. A profile carries an institution name and volumes — no PSU stands
 * behind any figure, and `psusServed` is a count, never an identity.
 */

export type TppArchetype =
  | 'data_aggregator'
  | 'bnpl_merchant'
  | 'neobank'
  | 'wealth'
  | 'sme_payments'
  | 'infrastructure'
  | 'onboarding'
  | 'dormant'

export interface TppProfile {
  organisationId: string
  legalName: string
  archetype: TppArchetype
  /** Monthly activity. Omitted keys mean the TPP does not use that service at all. */
  monthly: {
    /** Attended retail data pages served across all that TPP's PSUs. */
    retailDataPages?: number
    /** Distinct PSUs behind those pages — sets the free tier (15 attended pages/PSU/day). */
    psusServed?: number
    /** Corporate data-sharing pages (100 lines each), which have no free tier. */
    corporateDataPages?: number
    /** Merchant collections: total initiated value and the number of payments. */
    merchantCollectionValueAed?: number
    merchantCollectionCount?: number
    /** P2P / SME-to-SME initiations. */
    p2pCount?: number
    /** Corporate payments, including bulk. */
    corporatePaymentCount?: number
  }
}

/**
 * The nine consuming TPPs in the demo registry.
 *
 * Naming policy, carried over from seed-demo.ts and worth restating because it constrains the
 * data: institutions in a HEALTHY state use real UAE Open Finance provider names, because the
 * demo should read like the live ecosystem. Anything carrying a NEGATIVE synthetic state — an
 * unbilled-traffic alert, a suspension — uses an invented name, so no real brand is shown in a
 * bad light. Institution names are public information, not PSU PII.
 *
 * CALIBRATION. Retail volumes are set so the REFERENCE month (the current one, growth factor
 * 1.0) lands on its intended accrual. The free allowance is 15 attended pages x PSUs x 30 days,
 * so only `retailDataPages - 450 * psusServed` is chargeable — which is why these numbers sit
 * just above a multiple of the PSU count rather than at round figures. Move `psusServed` and the
 * revenue moves hard in the opposite direction; that is the threshold, not a bug.
 *
 * Two profiles (Tabby, Meydan) deliberately sit UNDER their allowance on data and earn nothing
 * from it. A demo that never shows a TPP inside its free tier hides half of how the scheme prices.
 *
 * The volumes below are shaped to each business, not sprinkled: an aggregator's cost is almost
 * entirely retail data pages, a BNPL's is almost entirely basis points on collection value, and
 * those two produce very different invoices. That contrast is the point — a Finance Analyst
 * should be able to look at the registry and tell what kind of business each counterparty is.
 */
export const DEMO_TPP_BOOK: readonly TppProfile[] = Object.freeze([
  {
    // Account aggregation at scale: heavy attended polling, no payment initiation.
    organisationId: 'org-lean-technologies',
    legalName: 'Lean Technologies',
    archetype: 'data_aggregator',
    monthly: { retailDataPages: 439_000, psusServed: 940, corporateDataPages: 2_400 }
  },
  {
    // BNPL: collection value is the whole story. At ~AED 194 a payment the AED 50 per-payment
    // cap never binds (it would take a ~AED 13,000 basket), so this line shows the bps taper
    // working rather than the cap — the cap is exercised by the large-value class instead.
    organisationId: 'org-tabby',
    legalName: 'Tabby',
    archetype: 'bnpl_merchant',
    monthly: { merchantCollectionValueAed: 41_500_000, merchantCollectionCount: 214_000, retailDataPages: 78_000, psusServed: 610 }
  },
  {
    // Infrastructure/aggregator serving other fintechs: broad mix, corporate-weighted.
    organisationId: 'org-tarabut-gateway',
    legalName: 'Tarabut Gateway',
    archetype: 'infrastructure',
    monthly: { retailDataPages: 291_000, psusServed: 640, corporateDataPages: 9_800, p2pCount: 24_000 }
  },
  {
    // Neobank: everyday P2P plus balance/transaction reads for its own app.
    organisationId: 'org-yap',
    legalName: 'YAP Digital Ltd',
    archetype: 'neobank',
    monthly: { retailDataPages: 239_000, psusServed: 520, p2pCount: 96_000 }
  },
  {
    // Wealth: low payment volume, steady portfolio reads, some corporate reporting.
    organisationId: 'org-sarwa',
    legalName: 'Sarwa Digital Wealth Ltd',
    archetype: 'wealth',
    monthly: { retailDataPages: 171_500, psusServed: 380, corporateDataPages: 1_900 }
  },
  {
    // SME payments: merchant collections at lower value, plus bulk corporate runs.
    organisationId: 'org-mamo',
    legalName: 'Mamo Pay FZ-LLC',
    archetype: 'sme_payments',
    monthly: { merchantCollectionValueAed: 6_300_000, merchantCollectionCount: 47_500, p2pCount: 18_000, corporatePaymentCount: 3_100 }
  },
  {
    // Onboarding — in the directory, no production traffic yet, so no accrual at all.
    organisationId: 'org-baraka',
    legalName: 'Baraka Financial Ltd',
    archetype: 'onboarding',
    monthly: {}
  },
  {
    // INVENTED NAME — carries the unbilled-traffic alert the Finance desk chases. Real traffic,
    // so it accrues; the alert is that it is not yet registered in the financial system (P9).
    organisationId: 'org-meydan-pay',
    legalName: 'Meydan Pay Technologies FZ-LLC',
    archetype: 'sme_payments',
    monthly: { merchantCollectionValueAed: 2_150_000, merchantCollectionCount: 16_400, retailDataPages: 41_000, psusServed: 210 }
  },
  {
    // INVENTED NAME — suspended, so traffic has stopped and the accrual is nil.
    organisationId: 'org-falaj-money',
    legalName: 'Falaj Money Ltd',
    archetype: 'dormant',
    monthly: {}
  }
])

/**
 * Two different drivers, because conflating them produced a book that looked broken.
 *
 * PAYMENTS are genuinely seasonal — Ramadan/Eid and the year-end retail peak move initiation
 * volume materially — so they carry a fixed monthly index on the calendar month (1-12).
 */
const PAYMENT_SEASONALITY: readonly number[] = [0.94, 0.91, 1.12, 1.08, 0.97, 0.93, 0.99, 1.02, 1.0, 1.06, 1.15, 1.09]

/**
 * DATA POLLING is not. An aggregator's page volume is set by how many PSUs it has connected and
 * how often it refreshes them — both structurally stable month to month, and both trending gently
 * up as it wins customers. So data grows on a slow compounding trend from a fixed anchor.
 *
 * This is a modelling correction, not a cosmetic one. Retail data pricing is a THRESHOLD (only
 * pages above 15/PSU/day are chargeable), and a threshold amplifies: with seasonality applied to
 * pages, a 3% swing in volume moved one aggregator's chargeable overage 5.8x and the book's
 * monthly total by 78% — which reads as a data error rather than a business. Seasonality belongs
 * on the driver that is actually seasonal.
 */
/**
 * Growth is measured BACKWARDS from the reference month, not forward from a fixed date. The
 * current month is always the top of the trend (factor 1.0) and earlier months sit below it.
 *
 * That matters because the demo's periods are relative to today: with a fixed anchor the book
 * compounded against wall-clock time, so the same aggregator that bills AED 242k this month would
 * bill over a million a year from now with nobody having changed a line. Anchoring to the
 * reference keeps the book stable in absolute terms for ever while still showing a business that
 * grew into its current position.
 */
const DATA_MONTHLY_GROWTH = 0.0035

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number) as [number, number]
  const [ty, tm] = to.split('-').map(Number) as [number, number]
  return (ty - fy) * 12 + (tm - fm)
}

/** The month the trend peaks at — defaults to now, injectable so tests stay deterministic. */
export function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7)
}

function paymentFactor(period: string): number {
  const month = Number(period.slice(5, 7))
  return PAYMENT_SEASONALITY[month - 1] ?? 1
}

function dataFactor(period: string, reference: string): number {
  // Months BEFORE the reference are negative, so the factor is < 1 and the trend rises to today.
  return (1 + DATA_MONTHLY_GROWTH) ** -monthsBetween(period, reference)
}

/** Scale a seasonal (payment) volume, keeping it a whole count. */
function scaledPayment(value: number | undefined, period: string): number {
  if (!value) return 0
  return Math.round(value * paymentFactor(period))
}

/** Scale a structural (data) volume on the growth trend, keeping it a whole count. */
function scaledData(value: number | undefined, period: string, reference: string): number {
  if (!value) return 0
  return Math.round(value * dataFactor(period, reference))
}

/**
 * Turn one profile into the metered lines a real month would have produced.
 *
 * The free tier is the part worth reading closely. The card grants 15 ATTENDED pages per PSU per
 * day (`psu_per_day`, the conservative granularity — see RetailFreeTierGranularity), so a month's
 * allowance is 15 x PSUs x days, and ONLY the excess is chargeable. An aggregator with many pages
 * spread thinly over many PSUs can therefore owe nothing at all, which is the scheme working as
 * designed — and a demo that never shows a TPP under its allowance is hiding the mechanic.
 */
export function meteredLinesFor(profile: TppProfile, period: string, reference: string = currentPeriod(), daysInMonth = 30): MeteredLine[] {
  const lines: MeteredLine[] = []
  const at = `${period}-15T12:00:00.000Z`
  const id = (suffix: string) => `demo-${profile.organisationId}-${period}-${suffix}`

  const retailPages = scaledData(profile.monthly.retailDataPages, period, reference)
  if (retailPages > 0) {
    const psus = profile.monthly.psusServed ?? 1
    const freeAllowance = SCHEME_RATE_CARD_2026_06_02.receivable['data.retail_page'].freeTier.attended * psus * daysInMonth
    const chargeable = Math.max(0, retailPages - freeAllowance)
    if (chargeable > 0) {
      lines.push({
        eventId: id('retail-data'), occurredAt: at, tppId: profile.organisationId,
        side: 'receivable', feeClass: 'data.retail_page', units: chargeable, freeUnits: Math.min(retailPages, freeAllowance)
      })
    }
  }

  const corporatePages = scaledData(profile.monthly.corporateDataPages, period, reference)
  if (corporatePages > 0) {
    lines.push({
      eventId: id('corp-data'), occurredAt: at, tppId: profile.organisationId,
      side: 'receivable', feeClass: 'data.corporate_page', units: corporatePages
    })
  }

  const collectionCount = scaledPayment(profile.monthly.merchantCollectionCount, period)
  if (collectionCount > 0) {
    // Priced per payment so the AED 50 cap applies per transaction, as the card states — pricing
    // the month's value as one line would silently cap the entire book at AED 50.
    const totalValue = aed(scaledPayment(profile.monthly.merchantCollectionValueAed, period))
    const perPayment = Math.round(totalValue / collectionCount)
    lines.push({
      eventId: id('merchant-collection'), occurredAt: at, tppId: profile.organisationId,
      side: 'receivable', feeClass: 'payment.merchant_collection', units: 1,
      valueMilliFils: perPayment, chargeableValueMilliFils: perPayment,
      merchantId: `demo-merchant-${profile.organisationId}`
    })
  }

  const p2p = scaledPayment(profile.monthly.p2pCount, period)
  if (p2p > 0) {
    lines.push({
      eventId: id('p2p'), occurredAt: at, tppId: profile.organisationId,
      side: 'receivable', feeClass: 'payment.p2p_sme', units: p2p
    })
  }

  const corporatePayments = scaledPayment(profile.monthly.corporatePaymentCount, period)
  if (corporatePayments > 0) {
    lines.push({
      eventId: id('corp-payment'), occurredAt: at, tppId: profile.organisationId,
      side: 'receivable', feeClass: 'payment.corporate', units: corporatePayments
    })
  }

  return lines
}

export interface TppAccrual {
  organisationId: string
  legalName: string
  archetype: TppArchetype
  /** Month-to-date receivable in milli-fils, priced by rateUsage against the scheme card. */
  accrualMilliFils: number
  /** Per-fee-class breakdown, so a screen can explain the number rather than assert it. */
  breakdown: Array<{ feeClass: string; units: number; amountMilliFils: number }>
}

/**
 * Price the whole book for a period. The merchant-collection line is priced once and multiplied
 * by the payment count: `rateUsage` applies the per-payment cap, and one representative payment
 * times the count is both correct under a flat cap and vastly cheaper than metering 214,000 rows
 * into a demo seed.
 */
export function accrueBook(period: string, card: RateCard = SCHEME_RATE_CARD_2026_06_02, reference: string = currentPeriod()): TppAccrual[] {
  return DEMO_TPP_BOOK.map((profile) => {
    const lines = meteredLinesFor(profile, period, reference)
    if (lines.length === 0) {
      return { organisationId: profile.organisationId, legalName: profile.legalName, archetype: profile.archetype, accrualMilliFils: 0, breakdown: [] }
    }
    const rated = rateUsage(lines, card, period)
    const statement = rated.statements.find((s) => s.tppId === profile.organisationId)
    const collectionCount = scaledPayment(profile.monthly.merchantCollectionCount, period)

    const breakdown = (statement?.receivable ?? []).map((line) => {
      const multiplier = line.feeClass === 'payment.merchant_collection' ? collectionCount : 1
      return {
        feeClass: line.feeClass,
        units: line.units * multiplier,
        amountMilliFils: line.amountMilliFils * multiplier
      }
    })

    return {
      organisationId: profile.organisationId,
      legalName: profile.legalName,
      archetype: profile.archetype,
      accrualMilliFils: breakdown.reduce((sum, line) => sum + line.amountMilliFils, 0),
      breakdown
    }
  })
}

/** The book keyed by organisation id — the shape a seed wants. */
export function accrualByTpp(period: string, reference: string = currentPeriod()): Map<string, TppAccrual> {
  return new Map(accrueBook(period, SCHEME_RATE_CARD_2026_06_02, reference).map((entry) => [entry.organisationId, entry]))
}
