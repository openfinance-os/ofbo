import { fils } from './money.js'
import type { BillingFeeClass } from './rate-card.js'
import { NEBRAS_CATEGORY_MAP, assertNoCustomerDetail, type NebrasCategoryMap, type ParsedTppCostDocumentLine, type TppCostDocumentType } from './tpp-cost-document.js'
import type { CostRecipientType, ExpectedTppCostStatementLine, TppCostFeeStream } from './tpp-cost.js'

/**
 * BILL-15 — three-way payable reconciliation (ADR 0007, IG v5.0 §10.13/§10.17).
 *
 * Own metering → expected statement → provider document. The expectation already carries the metering
 * evidence (BILL-12), the document is the provider's claim (BILL-14), and this module is the only place
 * the two are compared. It is pure: no clock, no store, no I/O — every timestamp it reasons about
 * arrives on the input, so a reconciliation is reproducible from its inputs alone.
 *
 * Amounts are integer milli-fils throughout, carrying the deviation documented on
 * `ExpectedTppCostStatement.currency` (BILL-17 owns resolving it).
 */

// ---------------------------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------------------------

/**
 * The ten payable break classes, frozen by BILL-13's `billing_tpp_cost_diff_line.break_type` CHECK.
 * Kept in this order so the constraint and the union read as one list.
 */
export const PAYABLE_BREAK_TYPES = [
  'quantity_variance',
  'rate_variance',
  'unexpected_charge',
  'missing_charge',
  'wrong_recipient',
  'duplicate_charge',
  'vat_variance',
  'period_variance',
  'unmatched_document_line',
  'unmatched_expected_line'
] as const

export type PayableBreakType = (typeof PAYABLE_BREAK_TYPES)[number]

/** Mirrors the contract's `LineType` enum; a payable break must be expressible as one of these. */
export type ReconciliationLineType =
  | 'nebras_fees'
  | 'payment_settlement'
  | 'consent_record'
  | 'tpp_aas_pass_through'
  | 'lfi_access_log'
  | 'dao_api_call'

export type PayableBreakPresence = 'both' | 'expected_only' | 'document_only'

/**
 * Scheme wording for the §10.17 late-payment charge, matched EXACTLY.
 *
 * Deliberately not a regex over "penalty": a category we do not recognise must stay
 * `unmatched_document_line` and reach a human, rather than be waved through as a penalty we then
 * accept because some unrelated payment ran late. Widening this set is a pricing-document decision.
 */
export const NEBRAS_PENALTY_SOURCE_CATEGORIES: readonly string[] = ['Late Payment Penalty']

/** IG v5.0 §10.13 — the scheme-published billing-query window, in calendar days. */
export const NEBRAS_QUERY_WINDOW_DAYS = 30

/**
 * Matching tolerance, in milli-fils.
 *
 * Expectations are milli-fils and provider documents state fils, so a sub-fil difference is a unit
 * artefact rather than a dispute. One fil is the smallest amount that can appear on an invoice, which
 * makes it the smallest difference the counterparty could act on.
 */
export const DEFAULT_PAYABLE_TOLERANCE_MILLI_FILS = fils(1)

/**
 * How large a break must be to BLOCK the period close.
 *
 * A different question from the tolerance above, and conflating them is the trap. Tolerance asks
 * "is this a difference at all, or a milli-fils/fils unit artefact" — below it, no break exists.
 * Materiality asks "is this difference worth refusing to close a period over" — below it the break
 * is real, recorded and queryable, it simply does not hold the month open.
 *
 * The two vocabularies are NOT interchangeable and never were: the payable side counts milli-fils,
 * while the E1 `BreakThreshold` counts fils under `unit: 'aed'`. Comparing one against the other
 * without converting judges almost every break immaterial by a factor of a thousand. This constant
 * is stated in milli-fils, like everything else on this side of the boundary, and equals the E1
 * default of one fil for `nebras_fees` and `lfi_access_log` — the two line types a payable break can
 * ever map to.
 */
export const DEFAULT_PAYABLE_MATERIALITY_MILLI_FILS = fils(1)

/**
 * Is this break material — big enough to hold the period open?
 *
 * `wrong_recipient` is material at ZERO variance, and that is not an edge case bolted on: paying
 * exactly the right amount to the wrong counterparty is not a rounding difference, it is money sent
 * to someone who was not owed it. The spec's own `TppCostDiffLine.material` description says so
 * verbatim ("A wrong recipient is material at zero variance"), so the code and the contract agree
 * rather than merely coexisting.
 *
 * Everything else is judged on the absolute variance, because a break's direction says who benefits,
 * not how much is at stake.
 */
/**
 * The value each construction site writes, and none of them decides.
 *
 * Every break is judged in ONE place (`isPayableBreakMaterial`, applied over the whole array before
 * anything reads it), so the field here is a placeholder rather than a verdict. Named, because the
 * previous literal `true` at all seven sites read as a decision each site had made — which is
 * exactly why nobody noticed that no site had made one.
 */
const MATERIALITY_DECIDED_CENTRALLY = false

export function isPayableBreakMaterial(
  breakType: PayableBreakType,
  varianceMilliFils: number,
  materialityMilliFils: number = DEFAULT_PAYABLE_MATERIALITY_MILLI_FILS
): boolean {
  if (breakType === 'wrong_recipient') return true
  return Math.abs(varianceMilliFils) > materialityMilliFils
}

/** Units are counted facts, so any difference is real; the constant exists to name that choice. */
const UNIT_TOLERANCE = 0

/**
 * IG v5.0 §10.13 response obligations, carried on the result so an open query shows what is owed and
 * by when without a second lookup of the guide.
 */
export const NEBRAS_RESPONSE_CLOCKS = {
  firstResponseMinutes: 10,
  finalResponseDays: 10,
  escalationReviewDays: 15
} as const

export type NebrasResponseClocks = typeof NEBRAS_RESPONSE_CLOCKS

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000
const BASIS_POINTS = 10_000

// ---------------------------------------------------------------------------------------------
// break_type → LineType (criterion 6a)
// ---------------------------------------------------------------------------------------------

/**
 * Express a payable break as the contract's `LineType`.
 *
 * `GET /back-office/reconciliation/breaks` classifies by `line_type` and declares no `break_type`, so
 * without this an payable break is not representable on the endpoint meant to show it. BILL-13 froze
 * the taxonomy and deferred the mapping here.
 *
 * The line class follows the COST RECIPIENT, not the break class: `line_type` names which stream a
 * break belongs to, and a rate variance is the same kind of line whether it is over-rated or
 * under-rated. IG §10.2's two payable components map one-to-one onto two line classes —
 *
 * - Hub fees → `nebras_fees`
 * - underlying-LFI API access → `lfi_access_log`, the artefact such a break is disputed from
 *
 * `payment_settlement` is deliberately unused: it means money movement, not fee liability, and an
 * underlying-LFI payment-API fee is still an access charge.
 *
 * `breakType` is therefore not a routing input but a guard. It is validated against the frozen
 * taxonomy so that an eleventh break class added without revisiting this mapping fails loudly instead
 * of being silently filed as a Hub fee.
 */
export function payableBreakToLineType(
  breakType: PayableBreakType,
  costRecipientType: CostRecipientType
): ReconciliationLineType {
  if (!(PAYABLE_BREAK_TYPES as readonly string[]).includes(breakType)) {
    throw new RangeError(`unknown payable break type ${breakType}: extend the LineType mapping before using it`)
  }
  return costRecipientType === 'nebras' ? 'nebras_fees' : 'lfi_access_log'
}

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

/** The expectation fields reconciliation reads. Structurally satisfied by `ExpectedTppCostStatement`. */
export interface ReconcilableExpectedStatement {
  period: string
  /**
   * Carried through to the result and onto the wire.
   *
   * Every amount here is milli-fils, a sub-minor unit that deviates from the binding money convention
   * and is unratified pending BILL-17. That is a reason to publish the currency beside the amounts,
   * not to omit it: a bare integer with neither unit nor currency is the shape that makes the eventual
   * conversion to `Money` expensive, and the sibling `TppCostDocument` schema already requires it.
   */
  currency: string
  lines: readonly ExpectedTppCostStatementLine[]
}

/** A stored provider document plus the ingest facts the query window is measured from. */
export interface ReconcilableDocument {
  documentId: string
  documentType: TppCostDocumentType
  issuerId: string
  documentReference: string
  billingPeriod: string
  issuedAt: string
  receivedAt: string
  lines: readonly ParsedTppCostDocumentLine[]
}

/** A payment of ours that missed its due date, which is what makes a §10.17 penalty legitimate. */
export interface LatePaymentRecord {
  period: string
  occurredAt: string
}

export interface ReconcilePayableInput {
  expected: ReconcilableExpectedStatement
  documents: readonly ReconcilableDocument[]
  /** Periods we actually paid late. Absent means none, so every penalty line is unexpected. */
  latePayments?: readonly LatePaymentRecord[]
  toleranceMilliFils?: number
  /**
   * The blocking threshold, distinct from `toleranceMilliFils`. Configurable because the adopting
   * bank owns what is worth holding a month open for; it is not a second tolerance.
   */
  materialityMilliFils?: number
  /** BD-21: the window is the scheme default until the bank's agreement says otherwise. */
  queryWindowDays?: number
  categoryMap?: NebrasCategoryMap
}

// ---------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------

export interface PayableBreak {
  lineRef: string
  breakType: PayableBreakType
  lineType: ReconciliationLineType
  presence: PayableBreakPresence
  costRecipientType: CostRecipientType
  costRecipientId: string
  feeClass: BillingFeeClass | null
  feeStream: TppCostFeeStream | null
  /** The provider's own wording, retained because it is what a query cites back to them. */
  sourceCategory: string | null
  /**
   * Always set. An expected-only break has no document line of its own, so it is attributed to the
   * period's primary document — the ledger row it belongs under is the one judging that document, and
   * a null here would leave the break with nowhere to be written.
   */
  documentId: string
  documentReference: string
  /** Set by the caller when the break is escalated into an E1 `reconciliation_break`. */
  reconciliationBreakId?: string
  expectedUnits: number
  actualUnits: number
  expectedNetMilliFils: number
  actualNetMilliFils: number
  expectedVatMilliFils: number
  actualVatMilliFils: number
  varianceMilliFils: number
  varianceBasisPoints: number
  material: boolean
  reasonCode: string
  /** Metering evidence from our side; empty when only the provider asserts the line. */
  eventIds: readonly string[]
  fapiInteractionIds: readonly string[]
}

/**
 * Per-document totals.
 *
 * `billing_tpp_cost_reconciliation` carries a single `document_id` with a foreign key, so a run over
 * several documents is several rows sharing a `reconciliation_run_id`. Each row must state what THAT
 * document was judged against; repeating the run-level aggregate on every row would overstate each one.
 */
export interface PayableReconciliationPerDocument {
  documentId: string
  documentReference: string
  matchedLineCount: number
  breakCount: number
  expectedNetMilliFils: number
  actualNetMilliFils: number
  netVarianceMilliFils: number
  grossVarianceMilliFils: number
}

export interface PayableReconciliation {
  period: string
  /** ISO 4217, carried from the expectation. Every milli-fils amount below is in this currency. */
  currency: string
  toleranceMilliFils: number
  queryWindowDays: number
  queryDeadline: string
  queryWindowStatus: 'open' | 'expired'
  daysRemainingAtIngest: number
  responseClocks: NebrasResponseClocks
  matchedLineCount: number
  breakCount: number
  breaks: PayableBreak[]
  /** Every document this run judged, off-period ones included — they were judged and found off-period. */
  documentIds: readonly string[]
  perDocument: PayableReconciliationPerDocument[]
  /** §10.17 penalties matched to a real late payment for this period, so charged legitimately. */
  penaltyLinesAccepted: number
  expectedTotalNetMilliFils: number
  actualTotalNetMilliFils: number
  /** Signed, so opposing errors net — the headline exposure. */
  netVarianceMilliFils: number
  /** Absolute, so opposing errors do NOT net away — the amount actually in dispute. */
  grossVarianceMilliFils: number
}

// ---------------------------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------------------------

function assertPeriod(value: string, label: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new RangeError(`${label} must be YYYY-MM`)
}

function assertTimestamp(value: string, label: string): number {
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) throw new RangeError(`${label} must be an ISO-8601 timestamp`)
  return parsed
}

/** The grain reconciliation matches on: who is charging, and for what. */
function matchKey(costRecipientType: string, costRecipientId: string, feeClass: string): string {
  return `${costRecipientType}|${costRecipientId}|${feeClass}`
}

function basisPoints(variance: number, expected: number): number {
  if (expected === 0) return variance === 0 ? 0 : BASIS_POINTS
  return Math.round((variance / expected) * BASIS_POINTS)
}

/** Fee classes the Hub could actually name on an invoice, derived from the maintained map. */
function invoiceableFeeClasses(map: NebrasCategoryMap): Set<string> {
  return new Set(Object.values(map.entries).map((entry) => entry.feeClass))
}

function isPenaltyLine(line: ParsedTppCostDocumentLine): boolean {
  return NEBRAS_PENALTY_SOURCE_CATEGORIES.includes(line.sourceCategory)
}

/** Document lines sharing a match key are one charge; a provider may break a category across rows. */
interface AggregatedDocumentLine {
  key: string
  documentId: string
  documentReference: string
  lineRefs: string[]
  sourceCategory: string
  feeClass: BillingFeeClass
  costRecipientType: CostRecipientType
  costRecipientId: string
  units: number
  netMilliFils: number
  vatMilliFils: number
}

function aggregate(document: ReconcilableDocument, lines: readonly ParsedTppCostDocumentLine[]): AggregatedDocumentLine[] {
  const byKey = new Map<string, AggregatedDocumentLine>()
  for (const line of lines) {
    const feeClass = line.feeClass as BillingFeeClass
    const key = matchKey(line.costRecipientType, line.costRecipientId, feeClass)
    const existing = byKey.get(key)
    if (existing) {
      existing.lineRefs.push(line.lineRef)
      existing.units += line.units
      existing.netMilliFils += line.actualNetMilliFils
      existing.vatMilliFils += line.vatMilliFils
      continue
    }
    byKey.set(key, {
      key,
      documentId: document.documentId,
      documentReference: document.documentReference,
      lineRefs: [line.lineRef],
      sourceCategory: line.sourceCategory,
      feeClass,
      costRecipientType: line.costRecipientType,
      costRecipientId: line.costRecipientId,
      units: line.units,
      netMilliFils: line.actualNetMilliFils,
      vatMilliFils: line.vatMilliFils
    })
  }
  return [...byKey.values()]
}

/**
 * Which variance class this difference belongs to, in the order the dispute evidence is gathered.
 *
 * Units first: a volume difference is settled against metering, and a rate argument built on the wrong
 * volume wastes the §10.13 window. Only when the counted facts agree does the money difference become
 * an argument about price. VAT last, because it is the residual once net agrees — a treatment error
 * (exclusive vs inclusive) rather than a pricing dispute, and it goes to a different desk.
 *
 * Returns null when nothing exceeds tolerance.
 */
function classifyVariance(
  expectedUnits: number,
  actualUnits: number,
  netVariance: number,
  vatVariance: number,
  tolerance: number
): PayableBreakType | null {
  if (Math.abs(actualUnits - expectedUnits) > UNIT_TOLERANCE) return 'quantity_variance'
  if (Math.abs(netVariance) > tolerance) return 'rate_variance'
  if (Math.abs(vatVariance) > tolerance) return 'vat_variance'
  return null
}

// ---------------------------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------------------------

/**
 * Match the period's provider documents against the expected statement.
 *
 * Every difference becomes exactly one break: an expected line and a document line that disagree on
 * the counterparty produce a single `wrong_recipient` rather than a missing charge plus an unexpected
 * one, and a charge repeated across two documents produces a `duplicate_charge` rather than being
 * counted twice. Netting is reported both ways, because an overcharge on one line does not settle an
 * undercharge on another — they are separate queries to the Hub.
 */
export function reconcilePayable(input: ReconcilePayableInput): PayableReconciliation {
  const { expected, documents } = input
  assertPeriod(expected.period, 'expected.period')
  if (documents.length === 0) {
    // No document means there is nothing to reconcile against, not a reconciliation with zero breaks.
    // Non-receipt is its own obligation (IG §10.12.2) and BILL-14's absence alarm is the instrument.
    throw new RangeError('reconcilePayable requires at least one provider document')
  }
  const tolerance = input.toleranceMilliFils ?? DEFAULT_PAYABLE_TOLERANCE_MILLI_FILS
  if (!Number.isSafeInteger(tolerance) || tolerance < 0) throw new RangeError('toleranceMilliFils must be a non-negative integer')
  const materiality = input.materialityMilliFils ?? DEFAULT_PAYABLE_MATERIALITY_MILLI_FILS
  if (!Number.isSafeInteger(materiality) || materiality < 0) throw new RangeError('materialityMilliFils must be a non-negative integer')
  const queryWindowDays = input.queryWindowDays ?? NEBRAS_QUERY_WINDOW_DAYS
  if (!Number.isSafeInteger(queryWindowDays) || queryWindowDays <= 0) throw new RangeError('queryWindowDays must be a positive integer')
  const categoryMap = input.categoryMap ?? NEBRAS_CATEGORY_MAP
  const invoiceable = invoiceableFeeClasses(categoryMap)
  const latePaidPeriods = new Set((input.latePayments ?? []).map((record) => record.period))

  const breaks: PayableBreak[] = []
  let penaltyLinesAccepted = 0
  let matchedLineCount = 0
  let expectedTotalNetMilliFils = 0
  // What the provider claims for THIS period. Off-period documents are deliberately excluded — their
  // amounts are a claim about another period and carry their own `period_variance` break — so this
  // total is not the sum of the input documents' totals whenever one of those is present.
  let actualTotalNetMilliFils = 0
  const matchedByDocument = new Map<string, { count: number; expected: number; actual: number }>()

  // --- Document-level triage -------------------------------------------------------------------
  //
  // A document for another period is not evidence about this one, so its lines are excluded from
  // matching rather than compared across periods. The expectation's own lines then surface as missing,
  // which is exactly true: this period's charge is absent from what we were sent.
  const inPeriod: ReconcilableDocument[] = []
  for (const document of documents) {
    assertPeriod(document.billingPeriod, 'document.billingPeriod')
    assertTimestamp(document.issuedAt, 'document.issuedAt')
    assertTimestamp(document.receivedAt, 'document.receivedAt')
    if (document.billingPeriod !== expected.period) {
      const net = document.lines.reduce((sum, line) => sum + line.actualNetMilliFils, 0)
      const vat = document.lines.reduce((sum, line) => sum + line.vatMilliFils, 0)
      const recipientType = document.lines[0]?.costRecipientType ?? 'nebras'
      breaks.push({
        lineRef: `${document.documentReference}|period`,
        breakType: 'period_variance',
        lineType: payableBreakToLineType('period_variance', recipientType),
        presence: 'document_only',
        costRecipientType: recipientType,
        costRecipientId: document.lines[0]?.costRecipientId ?? document.issuerId,
        feeClass: null,
        feeStream: null,
        sourceCategory: null,
        documentId: document.documentId,
        documentReference: document.documentReference,
        expectedUnits: 0,
        actualUnits: document.lines.reduce((sum, line) => sum + line.units, 0),
        expectedNetMilliFils: 0,
        actualNetMilliFils: net,
        expectedVatMilliFils: 0,
        actualVatMilliFils: vat,
        varianceMilliFils: net,
        varianceBasisPoints: basisPoints(net, 0),
        material: MATERIALITY_DECIDED_CENTRALLY,
        reasonCode: `document billed period ${document.billingPeriod}, reconciling ${expected.period}`,
        eventIds: [],
        fapiInteractionIds: []
      })
      continue
    }
    inPeriod.push(document)
  }

  // --- Line-level triage -----------------------------------------------------------------------
  //
  // Penalties and unmapped lines are pulled out before key matching. Neither has a fee class, so
  // neither can be compared to an expectation; deciding them here keeps them from masquerading as an
  // unexpected charge against a fee class we do price.
  const comparable: AggregatedDocumentLine[] = []
  for (const document of inPeriod) {
    const priceable: ParsedTppCostDocumentLine[] = []
    for (const line of document.lines) {
      if (isPenaltyLine(line)) {
        if (latePaidPeriods.has(document.billingPeriod)) {
          penaltyLinesAccepted += 1
          continue
        }
        // A penalty we cannot justify is an unexpected charge, NOT an unmapped line: we recognise the
        // category perfectly well and are refusing the charge, which is a query to raise rather than a
        // mapping to fix.
        breaks.push(documentOnlyBreak(document, line, 'unexpected_charge',
          `late-payment penalty charged with no late payment recorded for ${document.billingPeriod}`))
        continue
      }
      if (!line.mapped || line.feeClass === null) {
        breaks.push(documentOnlyBreak(document, line, 'unmatched_document_line',
          `provider category ${line.sourceCategory} is not in category map ${categoryMap.version}`))
        continue
      }
      priceable.push(line)
    }
    comparable.push(...aggregate(document, priceable))
  }

  // --- Duplicate detection ---------------------------------------------------------------------
  //
  // Across documents only. Lines repeating a key WITHIN one document were aggregated above, because a
  // provider may legitimately break a category over several rows. The same key on two documents is a
  // different claim: the Nebras invoice reconciles both cost components (IG §10.2), so an LFI
  // self-invoice repeating a charge is a duplicate rather than a second cost.
  const byKey = new Map<string, AggregatedDocumentLine[]>()
  for (const line of comparable) {
    const bucket = byKey.get(line.key)
    if (bucket) bucket.push(line)
    else byKey.set(line.key, [line])
  }
  const primary = new Map<string, AggregatedDocumentLine>()
  for (const [key, bucket] of byKey) {
    // Deterministic: the first document listed for the period holds the charge, the rest duplicate it.
    const [first, ...rest] = bucket
    primary.set(key, first!)
    for (const duplicate of rest) {
      // Counts toward the actual total. A duplicated charge is money we have genuinely been billed,
      // and excluding it would report a net variance of zero on an invoice pair that over-bills us by
      // the full line — the one number BILL-16 decides what to pay from.
      actualTotalNetMilliFils += duplicate.netMilliFils
      breaks.push({
        lineRef: `${duplicate.documentReference}|${duplicate.lineRefs.join('+')}`,
        breakType: 'duplicate_charge',
        lineType: payableBreakToLineType('duplicate_charge', duplicate.costRecipientType),
        presence: 'document_only',
        costRecipientType: duplicate.costRecipientType,
        costRecipientId: duplicate.costRecipientId,
        feeClass: duplicate.feeClass,
        feeStream: null,
        sourceCategory: duplicate.sourceCategory,
        documentId: duplicate.documentId,
        documentReference: duplicate.documentReference,
        expectedUnits: 0,
        actualUnits: duplicate.units,
        expectedNetMilliFils: 0,
        actualNetMilliFils: duplicate.netMilliFils,
        expectedVatMilliFils: 0,
        actualVatMilliFils: duplicate.vatMilliFils,
        varianceMilliFils: duplicate.netMilliFils,
        varianceBasisPoints: basisPoints(duplicate.netMilliFils, 0),
        material: MATERIALITY_DECIDED_CENTRALLY,
        reasonCode: `${duplicate.feeClass} already charged on ${first!.documentReference}`,
        eventIds: [],
        fapiInteractionIds: []
      })
    }
  }

  // --- Three-way match -------------------------------------------------------------------------
  const expectedByKey = new Map<string, ExpectedTppCostStatementLine>()
  for (const line of expected.lines) {
    const key = matchKey(line.costRecipientType, line.costRecipientId, line.feeClass)
    const existing = expectedByKey.get(key)
    if (existing) throw new Error(`duplicate expected line at match key ${key}`)
    expectedByKey.set(key, line)
  }

  const unmatchedExpected = new Map(expectedByKey)
  const unmatchedDocument = new Map(primary)

  for (const [key, own] of expectedByKey) {
    const claimed = primary.get(key)
    if (!claimed) continue
    unmatchedExpected.delete(key)
    unmatchedDocument.delete(key)
    expectedTotalNetMilliFils += own.expectedNetMilliFils
    actualTotalNetMilliFils += claimed.netMilliFils
    const netVariance = claimed.netMilliFils - own.expectedNetMilliFils
    const vatVariance = claimed.vatMilliFils - own.vatMilliFils
    const breakType = classifyVariance(own.units, claimed.units, netVariance, vatVariance, tolerance)
    if (breakType === null) {
      matchedLineCount += 1
      const tally = matchedByDocument.get(claimed.documentId) ?? { count: 0, expected: 0, actual: 0 }
      matchedByDocument.set(claimed.documentId, {
        count: tally.count + 1,
        expected: tally.expected + own.expectedNetMilliFils,
        actual: tally.actual + claimed.netMilliFils
      })
      continue
    }
    breaks.push({
      lineRef: `${claimed.documentReference}|${claimed.lineRefs.join('+')}`,
      breakType,
      lineType: payableBreakToLineType(breakType, own.costRecipientType),
      presence: 'both',
      costRecipientType: own.costRecipientType,
      costRecipientId: own.costRecipientId,
      feeClass: own.feeClass,
      feeStream: own.feeStream,
      sourceCategory: claimed.sourceCategory,
      documentId: claimed.documentId,
      documentReference: claimed.documentReference,
      expectedUnits: own.units,
      actualUnits: claimed.units,
      expectedNetMilliFils: own.expectedNetMilliFils,
      actualNetMilliFils: claimed.netMilliFils,
      expectedVatMilliFils: own.vatMilliFils,
      actualVatMilliFils: claimed.vatMilliFils,
      varianceMilliFils: netVariance,
      varianceBasisPoints: basisPoints(netVariance, own.expectedNetMilliFils),
      material: MATERIALITY_DECIDED_CENTRALLY,
      reasonCode: reasonFor(breakType, own, claimed),
      eventIds: own.eventIds,
      fapiInteractionIds: own.fapiInteractionIds
    })
  }

  // --- Recipient mismatch ----------------------------------------------------------------------
  //
  // Before calling anything missing or unexpected: an expectation and a document line that agree on
  // the fee class but not the counterparty are one charge billed to the wrong party, and raising it as
  // a pair is what makes it disputable. Two half-truths would send two queries to two counterparties.
  for (const [expectedKey, own] of [...unmatchedExpected]) {
    const candidates = [...unmatchedDocument.values()].filter((line) => line.feeClass === own.feeClass)
    // Only an unambiguous pair. With two document lines of the same fee class against different
    // counterparties there is no evidence here saying which one our expectation refers to, and a
    // guessed pairing would name the wrong counterparty in the query. Falling through leaves an honest
    // missing charge plus an unexpected one, which is what we can actually defend.
    if (candidates.length !== 1) continue
    const partner = candidates[0]!
    unmatchedExpected.delete(expectedKey)
    unmatchedDocument.delete(partner.key)
    expectedTotalNetMilliFils += own.expectedNetMilliFils
    actualTotalNetMilliFils += partner.netMilliFils
    breaks.push({
      lineRef: `${partner.documentReference}|${partner.lineRefs.join('+')}`,
      breakType: 'wrong_recipient',
      lineType: payableBreakToLineType('wrong_recipient', own.costRecipientType),
      presence: 'both',
      costRecipientType: own.costRecipientType,
      costRecipientId: own.costRecipientId,
      feeClass: own.feeClass,
      feeStream: own.feeStream,
      sourceCategory: partner.sourceCategory,
      documentId: partner.documentId,
      documentReference: partner.documentReference,
      expectedUnits: own.units,
      actualUnits: partner.units,
      expectedNetMilliFils: own.expectedNetMilliFils,
      actualNetMilliFils: partner.netMilliFils,
      expectedVatMilliFils: own.vatMilliFils,
      actualVatMilliFils: partner.vatMilliFils,
      varianceMilliFils: partner.netMilliFils - own.expectedNetMilliFils,
      varianceBasisPoints: basisPoints(partner.netMilliFils - own.expectedNetMilliFils, own.expectedNetMilliFils),
      material: MATERIALITY_DECIDED_CENTRALLY,
      reasonCode: `expected ${own.costRecipientType} ${own.costRecipientId}, billed by ${partner.costRecipientType} ${partner.costRecipientId}`,
      eventIds: own.eventIds,
      fapiInteractionIds: own.fapiInteractionIds
    })
  }

  // --- Expected but never billed ---------------------------------------------------------------
  //
  // An expected-only break has no document line, so it is filed under the period's primary document —
  // the in-period one if there is any, otherwise the only evidence we hold. `documents` is non-empty by
  // the guard above, so this is always defined.
  const fallbackDocument = (inPeriod[0] ?? documents[0])!
  for (const own of unmatchedExpected.values()) {
    expectedTotalNetMilliFils += own.expectedNetMilliFils
    // A fee class the Hub could never name on an invoice is OUR mapping gap, not their omission —
    // and must not be queried with them as a missing charge. `unmatched_expected_line` is the class
    // that says so, and it is fixed by extending the category map.
    const breakType: PayableBreakType = invoiceable.has(own.feeClass) ? 'missing_charge' : 'unmatched_expected_line'
    breaks.push({
      lineRef: `${expected.period}|${matchKey(own.costRecipientType, own.costRecipientId, own.feeClass)}`,
      breakType,
      lineType: payableBreakToLineType(breakType, own.costRecipientType),
      presence: 'expected_only',
      costRecipientType: own.costRecipientType,
      costRecipientId: own.costRecipientId,
      feeClass: own.feeClass,
      feeStream: own.feeStream,
      sourceCategory: null,
      documentId: fallbackDocument.documentId,
      documentReference: fallbackDocument.documentReference,
      expectedUnits: own.units,
      actualUnits: 0,
      expectedNetMilliFils: own.expectedNetMilliFils,
      actualNetMilliFils: 0,
      expectedVatMilliFils: own.vatMilliFils,
      actualVatMilliFils: 0,
      varianceMilliFils: -own.expectedNetMilliFils,
      varianceBasisPoints: basisPoints(-own.expectedNetMilliFils, own.expectedNetMilliFils),
      material: MATERIALITY_DECIDED_CENTRALLY,
      reasonCode: breakType === 'missing_charge'
        ? `expected ${own.feeClass} not billed for ${expected.period}`
        : `expected ${own.feeClass} has no provider category in map ${categoryMap.version}`,
      eventIds: own.eventIds,
      fapiInteractionIds: own.fapiInteractionIds
    })
  }

  // --- Billed but never expected ---------------------------------------------------------------
  for (const claimed of unmatchedDocument.values()) {
    actualTotalNetMilliFils += claimed.netMilliFils
    breaks.push({
      lineRef: `${claimed.documentReference}|${claimed.lineRefs.join('+')}`,
      breakType: 'unexpected_charge',
      lineType: payableBreakToLineType('unexpected_charge', claimed.costRecipientType),
      presence: 'document_only',
      costRecipientType: claimed.costRecipientType,
      costRecipientId: claimed.costRecipientId,
      feeClass: claimed.feeClass,
      feeStream: null,
      sourceCategory: claimed.sourceCategory,
      documentId: claimed.documentId,
      documentReference: claimed.documentReference,
      expectedUnits: 0,
      actualUnits: claimed.units,
      expectedNetMilliFils: 0,
      actualNetMilliFils: claimed.netMilliFils,
      expectedVatMilliFils: 0,
      actualVatMilliFils: claimed.vatMilliFils,
      varianceMilliFils: claimed.netMilliFils,
      varianceBasisPoints: basisPoints(claimed.netMilliFils, 0),
      material: MATERIALITY_DECIDED_CENTRALLY,
      reasonCode: `${claimed.sourceCategory} billed with no metered usage for ${expected.period}`,
      eventIds: [],
      fapiInteractionIds: []
    })
  }

  // --- Query window ----------------------------------------------------------------------------
  //
  // Anchored to the earliest issue date among the documents that bill THIS period, and measured
  // against the latest arrival: of the windows in play the one closing first governs, and a
  // reconciliation that overstates the time remaining loses the right to query.
  //
  // Off-period documents are excluded from the anchor. Their issue date says nothing about when this
  // period's charges became queryable, and letting an older one in silently shortens the window —
  // abandoning a live query early is as wrong as missing a dead one. They anchor only when there is
  // nothing else: with no in-period document at all, the earliest evidence we hold is the most
  // conservative available anchor.
  const anchorSource = inPeriod.length > 0 ? inPeriod : documents
  const anchor = Math.min(...anchorSource.map((document) => Date.parse(document.issuedAt)))
  const ingest = Math.max(...documents.map((document) => Date.parse(document.receivedAt)))
  const deadline = new Date(anchor + queryWindowDays * DAY_MILLISECONDS)
  const daysRemainingAtIngest = Math.ceil((deadline.getTime() - ingest) / DAY_MILLISECONDS)

  // --- Materiality -----------------------------------------------------------------------------
  //
  // Applied ONCE here rather than at each of the seven construction sites. Those sites know the
  // variance but not the policy, and seven inline copies of a judgement is how the previous
  // hardcoded `true` survived: every site looked locally reasonable. Doing it centrally also means
  // `perDocument` and the returned totals below all observe the same decision.
  //
  // What this changes, stated precisely: at the DEFAULTS materiality equals the matching tolerance,
  // so every break that exists is still material and no default behaviour moves. What moves is that
  // `openPayableBreaks`'s `AND d.material` now filters on a DERIVED judgement rather than on a
  // literal `true` that filtered nothing — and a bank that sets a higher threshold can now have a
  // break stay real, recorded and queryable without holding the month open.
  for (const entry of breaks) {
    entry.material = isPayableBreakMaterial(entry.breakType, entry.varianceMilliFils, materiality)
  }

  // --- Per-document rollup ---------------------------------------------------------------------
  //
  // Seeded from the documents rather than from the breaks, so a document that produced neither a match
  // nor a break still gets a row. Its zeroes are the finding: we judged it and it said nothing.
  const perDocument: PayableReconciliationPerDocument[] = documents.map((document) => {
    const matched = matchedByDocument.get(document.documentId) ?? { count: 0, expected: 0, actual: 0 }
    const mine = breaks.filter((entry) => entry.documentId === document.documentId)
    const expectedNet = matched.expected + mine.reduce((sum, entry) => sum + entry.expectedNetMilliFils, 0)
    const actualNet = matched.actual + mine.reduce((sum, entry) => sum + entry.actualNetMilliFils, 0)
    return {
      documentId: document.documentId,
      documentReference: document.documentReference,
      matchedLineCount: matched.count,
      breakCount: mine.length,
      expectedNetMilliFils: expectedNet,
      actualNetMilliFils: actualNet,
      netVarianceMilliFils: actualNet - expectedNet,
      grossVarianceMilliFils: mine.reduce((sum, entry) => sum + Math.abs(entry.varianceMilliFils), 0)
    }
  })

  return {
    currency: expected.currency,
    documentIds: documents.map((document) => document.documentId),
    perDocument,
    period: expected.period,
    toleranceMilliFils: tolerance,
    queryWindowDays,
    queryDeadline: deadline.toISOString(),
    queryWindowStatus: daysRemainingAtIngest >= 0 ? 'open' : 'expired',
    daysRemainingAtIngest,
    responseClocks: NEBRAS_RESPONSE_CLOCKS,
    matchedLineCount,
    breakCount: breaks.length,
    breaks,
    penaltyLinesAccepted,
    expectedTotalNetMilliFils,
    actualTotalNetMilliFils,
    netVarianceMilliFils: actualTotalNetMilliFils - expectedTotalNetMilliFils,
    grossVarianceMilliFils: breaks.reduce((sum, entry) => sum + Math.abs(entry.varianceMilliFils), 0)
  }
}

// ---------------------------------------------------------------------------------------------
// Billing-query evidence bundle (IG v5.0 §10.11.3)
// ---------------------------------------------------------------------------------------------

/**
 * The fields IG v5.0 §10.11.3 requires on a billing query.
 *
 * Declared as data so completeness is checked by iterating this list rather than by a reviewer reading
 * the builder — the failure mode is a field quietly dropped, which no amount of care in the builder
 * catches.
 */
export const IG_BILLING_QUERY_REQUIRED_FIELDS = [
  'invoiceNumber',
  'interactionId',
  'occurredAt',
  'lfiName',
  'tppName',
  'transactionDetail'
] as const

export type IgBillingQueryRequiredField = (typeof IG_BILLING_QUERY_REQUIRED_FIELDS)[number]

/** Scalar facts about the disputed charge. Deliberately not the payment itself — see the builder. */
export type BillingQueryTransactionDetail = Readonly<Record<string, string | number>>

export interface BillingQueryBundleInput {
  queryReference: string
  raisedAt: string
  billingPeriod: string
  invoiceNumber: string
  /** `x-fapi-interaction-id` of the interaction under query. */
  interactionId: string
  occurredAt: string
  lfiName: string
  tppName: string
  transactionDetail: BillingQueryTransactionDetail
  breakType: PayableBreakType
  reasonCode: string
  varianceMilliFils: number
  queryDeadline: string
  daysRemaining: number
}

export interface BillingQueryBundle extends BillingQueryBundleInput {
  responseClocks: NebrasResponseClocks
}

/**
 * Assemble a submittable billing query, or refuse.
 *
 * Refusal is the point of this function. It crosses the bank boundary — the bundle goes to Nebras
 * through P6 — and each of the three refusals prevents an unrecoverable outcome rather than a tidy one:
 *
 * - A missing required field produces a query Nebras rejects for incompleteness, and the days it
 *   consumed do not come back. Building it partial is worse than not building it.
 * - A closed window means asserting a claim we no longer hold. `daysRemaining` is computed by
 *   `reconcilePayable` from evidence, so this reads a fact rather than a clock.
 * - Customer detail would export PSU data to the scheme. §10.11.3 asks for "payment/transaction
 *   detail" and the obvious reading is to attach the payment; the fields a query actually needs are
 *   the charge's own facts — fee class, category, units, amounts — so the guard refuses rather than
 *   redacts, exactly as BILL-14 does for structured columns.
 *
 * Screened by NAME and by VALUE, and every text field on the bundle, not only `transactionDetail`.
 * Both halves of that sentence were once a claim rather than a description — the screen applied value
 * shapes only, and skipped four fields including the IG-required `occurredAt`. A value-shape screen
 * cannot see a name or an address, and `transactionDetail` is an open record whose KEYS the caller
 * chooses, so key-name screening is not belt-and-braces here; it is the half that catches the obvious
 * case. `reasonCode` is the one that makes the rest more than belt-and-braces: an unmapped line's
 * reason code embeds the provider's own
 * `sourceCategory`, so provider-supplied text does reach the wire here. BILL-14 already refuses an
 * identifier-shaped category at ingest, which is the right boundary — but that leaves this artefact
 * depending on an invariant established two stories away, and it is the artefact that actually leaves
 * the bank. Re-screening at the point of departure costs nothing and makes the bundle self-sufficient.
 *
 * Values are coerced to string before screening rather than skipped when non-string. The shapes
 * currently all require a letter, dash, `@` or leading `+`/`00`, so a number cannot match one today —
 * but that is a property of today's list, not of numbers, and a future digit-only rule would other-
 * wise be silently bypassed by the one type that can carry digits.
 */
export function buildBillingQueryBundle(input: BillingQueryBundleInput): BillingQueryBundle {
  for (const field of IG_BILLING_QUERY_REQUIRED_FIELDS) {
    const value = input[field]
    const empty = value === undefined || value === null || value === ''
      || (typeof value === 'object' && Object.keys(value).length === 0)
    if (empty) {
      throw new RangeError(
        `billing query is missing the IG §10.11.3 required field ${field}; a query rejected for `
        + 'incompleteness still consumes the window, so it is not built'
      )
    }
  }
  if (input.daysRemaining < 0) {
    throw new RangeError(
      `billing query window closed on ${input.queryDeadline}; the claim can no longer be asserted`
    )
  }
  // EVERY text field, which the paragraph above claimed and this list did not deliver: raisedAt,
  // occurredAt, billingPeriod and queryDeadline were omitted, and occurredAt is one of the six the IG
  // REQUIRES. They are free-form strings with no format validation anywhere in this builder — the BFF
  // threads occurredAt straight through from its caller — so "unlikely to carry PSU data" was an
  // assumption about callers, not a property of the field.
  const screened: Record<string, string> = {
    queryReference: input.queryReference,
    invoiceNumber: input.invoiceNumber,
    interactionId: input.interactionId,
    lfiName: input.lfiName,
    tppName: input.tppName,
    reasonCode: input.reasonCode,
    raisedAt: input.raisedAt,
    occurredAt: input.occurredAt,
    billingPeriod: input.billingPeriod,
    queryDeadline: input.queryDeadline
  }
  for (const [name, value] of Object.entries(input.transactionDetail)) {
    screened[`transactionDetail.${name}`] = String(value)
  }
  // Both controls, not just the value shapes. `transactionDetail` is an open
  // Record<string, string | number>, so its KEYS are the caller's too — and a payer name or address
  // matches none of the four shapes, which made the shape screen alone a control that could not see
  // the most obvious way PSU data would arrive here. The transactionDetail.* prefix is preserved in
  // the key, so `transactionDetail.payerName` still matches the `payer` fragment.
  assertNoCustomerDetail(screened)
  return { ...input, responseClocks: NEBRAS_RESPONSE_CLOCKS }
}

function documentOnlyBreak(
  document: ReconcilableDocument,
  line: ParsedTppCostDocumentLine,
  breakType: PayableBreakType,
  reasonCode: string
): PayableBreak {
  return {
    lineRef: `${document.documentReference}|${line.lineRef}`,
    breakType,
    lineType: payableBreakToLineType(breakType, line.costRecipientType),
    presence: 'document_only',
    costRecipientType: line.costRecipientType,
    costRecipientId: line.costRecipientId,
    feeClass: line.feeClass,
    feeStream: null,
    sourceCategory: line.sourceCategory,
    documentId: document.documentId,
    documentReference: document.documentReference,
    expectedUnits: 0,
    actualUnits: line.units,
    expectedNetMilliFils: 0,
    actualNetMilliFils: line.actualNetMilliFils,
    expectedVatMilliFils: 0,
    actualVatMilliFils: line.vatMilliFils,
    varianceMilliFils: line.actualNetMilliFils,
    varianceBasisPoints: basisPoints(line.actualNetMilliFils, 0),
    material: MATERIALITY_DECIDED_CENTRALLY,
    reasonCode,
    eventIds: [],
    fapiInteractionIds: []
  }
}

function reasonFor(
  breakType: PayableBreakType,
  own: ExpectedTppCostStatementLine,
  claimed: AggregatedDocumentLine
): string {
  if (breakType === 'quantity_variance') return `expected ${own.units} units, billed ${claimed.units}`
  if (breakType === 'vat_variance') return `net agrees; VAT ${claimed.vatMilliFils} against expected ${own.vatMilliFils} milli-fils`
  return `expected ${own.expectedNetMilliFils}, billed ${claimed.netMilliFils} milli-fils at unchanged volume`
}
