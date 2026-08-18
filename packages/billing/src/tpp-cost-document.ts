import { divideHalfUp, fils } from './money.js'
import type { BillingFeeClass } from './rate-card.js'
import type { CostRecipientType } from './tpp-cost.js'

/**
 * The provider cost-document taxonomy (ADR 0007 D9, IG v5.0 §10). Mirrors the `document_type` CHECK
 * in migration 0039 exactly — the schema and this union must not drift apart.
 */
export type TppCostDocumentType =
  | 'nebras_tax_invoice'
  | 'nebras_settlement_statement'
  | 'lfi_self_invoice'
  | 'credit_note'
  | 'debit_note'
  | 'manual_adjustment'

/**
 * BILL-14 — parsing provider cost documents into the payable actuals (ADR 0007 D9, IG v5.0 §10).
 *
 * The Nebras monthly tax invoice is PRIMARY: the Hub calculates and collects both fee streams, so a
 * single document may carry Hub fees and underlying-LFI charges together (IG §10.2) even though the
 * §10.9 sample shows Hub sections only. Both layouts are accepted.
 *
 * Three properties are load-bearing here, each for a different reason:
 *
 * 1. **VAT is split by stream, not by document** (ADR 0007 D4). Hub-fee sections are VAT-EXCLUSIVE —
 *    the invoice states Taxable/VAT/Gross columns on net scheme rates. TPP-to-LFI charges are
 *    scheme-defined VAT-INCLUSIVE, so VAT is carved out at 5/105. Applying one treatment to both
 *    mis-states the payable by ~5% in one direction or the other.
 * 2. **Totals are derived, then checked against the provider's own.** We sum the lines and compare;
 *    a disagreement is refused rather than silently resolved in either party's favour, because
 *    "trust the header" and "trust the lines" are both wrong when they conflict.
 * 3. **Customer detail is removed HERE, before any caller can persist** — the cost tables are
 *    INSERT-only with no deletion path (migration 0039), so anything that lands is unremovable. Two
 *    different mechanisms, because two different kinds of field:
 *
 *    - The free-form provider payload is REDACTED (`redactProviderPayload`) and the parser returns
 *      only the redacted copy; there is no accessor for the raw one.
 *    - The STRUCTURED identifier fields the parser lifts into their own columns — `line_ref`,
 *      `category`, `cost_recipient_id`, the document reference, issuer/recipient ids and TRNs —
 *      cannot be redacted, because `line_ref` is part of a UNIQUE key and `category` is the evidence
 *      a fee-class mapping derives from. A marker there would destroy identity, so a document
 *      carrying a customer-detail shape in any of them is REFUSED instead
 *      (`assertIdentifierFieldsClean`). An earlier version of this module redacted the payload only
 *      and let those columns through unchecked, which was the more dangerous half.
 *
 * Parsing sits behind {@link TppCostDocumentParser} so a scheme or enterprise transport (PDF, EDI,
 * an API pull) can be added without touching the ingest service.
 */

const VAT_NUMERATOR = 5
const VAT_DENOMINATOR = 100
const VAT_INCLUSIVE_DENOMINATOR = 105

export class UnparseableDocumentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnparseableDocumentError'
  }
}

export interface VatSplit {
  netMilliFils: number
  vatMilliFils: number
  grossMilliFils: number
}

/**
 * Hub fees: the stated amount is NET and 5% is added on top (IG §10.9 Taxable/VAT/Gross columns).
 * Gross is computed as net + vat rather than net × 1.05 so the three always reconcile exactly.
 */
export function splitVatExclusive(netMilliFils: number): VatSplit {
  const vatMilliFils = divideHalfUp(netMilliFils * VAT_NUMERATOR, VAT_DENOMINATOR)
  return { netMilliFils, vatMilliFils, grossMilliFils: netMilliFils + vatMilliFils }
}

/**
 * TPP-to-LFI fees: the stated amount is GROSS and VAT is carved out at 5/105. Net is computed as
 * gross − vat for the same reconciliation reason.
 */
export function splitVatInclusive(grossMilliFils: number): VatSplit {
  const vatMilliFils = divideHalfUp(grossMilliFils * VAT_NUMERATOR, VAT_INCLUSIVE_DENOMINATOR)
  return { netMilliFils: grossMilliFils - vatMilliFils, vatMilliFils, grossMilliFils }
}

// ---------------------------------------------------------------------------------------------
// Provider category → fee class
// ---------------------------------------------------------------------------------------------

export interface NebrasCategoryMapEntry {
  feeClass: BillingFeeClass
  costRecipientType: CostRecipientType
}

export interface NebrasCategoryMap {
  version: string
  source: string
  entries: Readonly<Record<string, NebrasCategoryMapEntry>>
}

/**
 * The maintained provider-category → fee-class mapping.
 *
 * Deliberately PARTIAL, and that is the point. It carries only the categories whose correspondence
 * to a fee class we already price is unambiguous by name. Four IG categories are knowingly absent:
 *
 * - `Balance (Discounted)` and `CoP (Discounted)` — the §10.9 sample shows a unit anomaly on the
 *   discounted CoP rate (0.25 vs 0.005). Mapping them before BD-20 resolves it on a real invoice
 *   would silently mis-state the payable, which is worse than flagging the line.
 * - `Payment Data` and `Setup and Consent` — no fee class in the current rate card corresponds to
 *   either without inventing scheme semantics.
 *
 * Unmapped lines are stored with `mapped: false` and surface for a human to map (BILL-15 raises them
 * as unmatched). Data rather than code so a correction is a config change, not a release.
 */
export const NEBRAS_CATEGORY_MAP: NebrasCategoryMap = {
  version: '2026.06.02',
  source: 'UAE Open Finance Commercial & Pricing Model v1.0 + Nebras Interaction Guide v5.0 §10.9/§10.10',
  entries: {
    'Payment Initiation': { feeClass: 'hub.standard', costRecipientType: 'nebras' },
    'Corporate Payment': { feeClass: 'payment.corporate', costRecipientType: 'underlying_lfi' },
    'Bank Data Sharing': { feeClass: 'data.retail_page', costRecipientType: 'underlying_lfi' },
    'Corporate Data': { feeClass: 'data.corporate_page', costRecipientType: 'underlying_lfi' },
    'Insurance Quote Sharing': { feeClass: 'hub.quote', costRecipientType: 'nebras' }
  }
}

export interface MappedCategory {
  sourceCategory: string
  feeClass: BillingFeeClass | null
  mapped: boolean
  costRecipientType: CostRecipientType | null
}

/** Resolve a provider category, flagging rather than guessing when it is unknown. */
export function mapSourceCategory(map: NebrasCategoryMap, sourceCategory: string): MappedCategory {
  const entry = map.entries[sourceCategory]
  if (!entry) return { sourceCategory, feeClass: null, mapped: false, costRecipientType: null }
  return {
    sourceCategory,
    feeClass: entry.feeClass,
    mapped: true,
    costRecipientType: entry.costRecipientType
  }
}

// ---------------------------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------------------------

/**
 * Field names that carry customer detail. Matched case-insensitively as substrings, because provider
 * field naming is not ours to control (`customerName`, `psu_id`, `payer.account_name`, …).
 */
const PSU_KEY_FRAGMENTS = [
  'psu', 'customer', 'payer', 'payee', 'beneficiary', 'account_name', 'accountname',
  'account_number', 'accountnumber', 'iban', 'card', 'emirates', 'national_id', 'nationalid',
  'passport', 'phone', 'mobile', 'email', 'address', 'dob', 'date_of_birth', 'dateofbirth',
  'first_name', 'last_name', 'full_name', 'fullname', 'holder'
]

/**
 * Value shapes that are customer detail whatever they are called. Keyed on STRUCTURE, not on the
 * real-world prefixes — an Emirates ID is `\d{3}-\d{4}-\d{7}-\d` whether it starts 784 (real) or 999
 * (the synthetic form fixtures must use), and a UAE IBAN is `AE` + 21 digits whatever the bank code.
 * Keying on the shape is what lets this catch a real value it has never been shown.
 */
const PSU_VALUE_SHAPES: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'iban', pattern: /\bAE\d{21}\b/i },
  { label: 'national-id', pattern: /\b\d{3}-\d{4}-\d{7}-\d\b/ },
  { label: 'email', pattern: /[^\s@]+@[^\s@]+\.[^\s@]+/ },
  // The +/00 international prefix must not be allowed to match INSIDE a longer digit run: a 15-digit
  // TRN such as 100123456700003 contains "00" followed by twelve digits, so an unanchored version of
  // this pattern redacted every invoice's TRNs. The lookaround requires the prefix to start the number.
  { label: 'phone', pattern: /(?<!\d)(?:\+|00)\d{9,14}(?!\d)/ }
]

/**
 * Deliberately NOT here: a generic "long run of digits" rule.
 *
 * It was, and it redacted the two TRNs in every invoice header — a UAE Tax Registration Number is 15
 * digits, and TRNs are REQUIRED header evidence on a tax invoice (IG §10.9), not customer detail. A
 * heuristic that destroys a mandatory field to catch a hypothetical one is the wrong trade, and it also
 * inflated the redaction count an auditor reads.
 *
 * Residual risk, stated rather than papered over: a bare account or card number under a key this list
 * does not recognise would survive. Account and card numbers ARE covered under their conventional
 * namings (`account_number`, `card…`, `iban`) and by the IBAN shape above. If a real Nebras invoice
 * turns out to carry payment-level identifiers under some other key, the fix is to add that key here —
 * observable, because BILL-15 reconciliation reads these lines — not to re-broaden the digit rule.
 */


export const REDACTED = '[redacted]'

/**
 * Refuse a document whose STRUCTURED identifier fields carry a customer-detail shape.
 *
 * Redaction cannot help here, and that distinction matters. `line_ref`, `source_category`,
 * `cost_recipient_id`, `document_reference`, the issuer/recipient ids and the TRNs are lifted out of
 * the provider document into their own columns — `line_ref` is part of a UNIQUE key, and
 * `source_category` is the evidence a fee-class mapping is derived from. Replacing any of them with a
 * marker would destroy identity rather than protect a customer.
 *
 * So the document is REFUSED instead. A provider putting an IBAN or a national identifier in a line
 * reference is malformed, and in a family with no deletion path, rejecting the upload is strictly
 * better than storing it and discovering later that it cannot be removed. Shape-keyed for the same
 * reason as the payload redactor: it has to catch a real value it has never been shown.
 *
 * This closes a gap the payload redactor left wide open — these columns never passed through it, and
 * `billing_tpp_cost_document_line` is cross-tenant readable under the ratified governed-aggregate seam.
 */
export function assertIdentifierFieldsClean(fields: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value !== 'string' || value === '') continue
    const shape = redactedValueShape(value)
    if (shape) {
      throw new UnparseableDocumentError(
        `refusing the document: its ${name} carries a ${shape} shape, and that field is stored as a `
        + 'structured column in a ledger with no deletion path. Redaction cannot apply — the field is '
        + 'part of the record identity — so a document carrying customer detail there is rejected. '
        + '(The offending value is deliberately not echoed.)'
      )
    }
  }
}

export interface RedactionResult {
  redacted: unknown
  /** Key paths that were removed. Never the values — reporting those would defeat the redaction. */
  removedPaths: string[]
}

/**
 * Refuse a set of fields that carries customer detail by NAME or by VALUE.
 *
 * `assertIdentifierFieldsClean` screens values against four known SHAPES. That is the right control
 * for a provider document, where the field names are the schema's and only the values are theirs.
 * It is not sufficient on its own anywhere the field NAMES are open too: a name, an address or a
 * date of birth matches no shape, so `{ payerName: '…', payerAddress: '…' }` passes a value-shape
 * screen completely. `redactProviderPayload` has always applied both controls; a caller that reached
 * for only one of them got the weaker half of a pair that was designed together.
 *
 * Refuses rather than redacts, because the callers of this are artefacts that leave the bank or land
 * in a no-deletion-path table: a `[redacted]` marker in a scheme billing query is not a better
 * outcome than not sending one.
 */
export function assertNoCustomerDetail(fields: Record<string, string | undefined>): void {
  for (const name of Object.keys(fields)) {
    if (shouldRedactKey(name)) {
      throw new UnparseableDocumentError(
        `refusing: the field ${name} is named for customer detail, and this artefact cannot carry `
        + 'it. Value shapes are screened separately — a name or an address matches none of them, so '
        + 'the field name is the only signal there is. (The value is deliberately not echoed.)'
      )
    }
  }
  assertIdentifierFieldsClean(fields)
}

function shouldRedactKey(key: string): boolean {
  const lower = key.toLowerCase()
  return PSU_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment))
}

function redactedValueShape(value: string): string | null {
  const hit = PSU_VALUE_SHAPES.find((shape) => shape.pattern.test(value))
  return hit ? hit.label : null
}

/**
 * Remove customer detail from a provider payload, by key name and by value shape, at any depth.
 *
 * Numbers and booleans are left alone: the operational evidence (units, prices, counts) is exactly
 * what the document is retained for, and redaction that guts it would trade one defect for another.
 */
export function redactProviderPayload(value: unknown): RedactionResult {
  const removedPaths: string[] = []

  const walk = (node: unknown, path: string): unknown => {
    if (typeof node === 'string') {
      if (node === REDACTED) return node
      const shape = redactedValueShape(node)
      if (shape) {
        removedPaths.push(`${path} (${shape})`)
        return REDACTED
      }
      return node
    }
    if (node === null || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map((item, index) => walk(item, `${path}[${index}]`))

    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key
      // A PSU-named field is replaced whole — including a nested object, so nothing under it can
      // survive by having an innocuous key. Already-redacted values are left alone and NOT
      // re-reported: that is what makes this function idempotent, which the store's boundary check
      // (assertRedactedPayload) depends on to tell "already clean" from "never redacted".
      if (shouldRedactKey(key) && child !== REDACTED) {
        removedPaths.push(`${childPath} (key)`)
        out[key] = REDACTED
        continue
      }
      out[key] = walk(child, childPath)
    }
    return out
  }

  return { redacted: walk(value, ''), removedPaths }
}

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

export interface ParsedTppCostDocumentLine {
  lineRef: string
  sourceCategory: string
  feeClass: BillingFeeClass | null
  mapped: boolean
  costRecipientType: CostRecipientType
  costRecipientId: string
  units: number
  unitPriceMilliFils: number
  actualNetMilliFils: number
  vatMilliFils: number
  actualGrossMilliFils: number
}

export interface ParsedTppCostDocument {
  documentType: TppCostDocumentType
  issuerId: string
  issuerTrn: string
  recipientId: string
  recipientTrn: string
  documentReference: string
  billingPeriod: string
  currency: 'AED'
  issuedAt: string
  dueAt: string | null
  netMilliFils: number
  vatMilliFils: number
  grossMilliFils: number
  lines: ParsedTppCostDocumentLine[]
  /** Already redacted. There is no accessor for the raw provider payload. */
  payload: unknown
  redactedFieldCount: number
  redactedPaths: string[]
  unmappedLineCount: number
}

/** The seam a scheme or enterprise transport plugs into (PDF extraction, EDI, an API pull). */
export interface TppCostDocumentParser {
  readonly documentType: TppCostDocumentType
  parse(input: unknown): ParsedTppCostDocument
}

const PERIOD = /^[0-9]{4}-(0[1-9]|1[0-2])$/

function requireString(source: Record<string, unknown>, key: string, label = key): string {
  const value = source[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new UnparseableDocumentError(`${label} is required`)
  }
  return value
}

/**
 * A real RFC 3339 instant, normalised to ISO.
 *
 * The contract declares `issued_at` as `format: date-time` and the value is echoed straight onto the
 * wire, so accepting any non-empty string was a latent contract violation: Postgres happily parses
 * "3 July 2026" into the timestamptz column, and the response would then carry it verbatim.
 */
function requireIsoDateTime(source: Record<string, unknown>, key: string): string {
  const raw = requireString(source, key, key)
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) {
    throw new UnparseableDocumentError(`${key} must be an RFC 3339 date-time.`)
  }
  // Reject forms that parse but are not RFC 3339 — the contract promises a date-time, not "parseable".
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(raw.trim())) {
    throw new UnparseableDocumentError(
      `${key} must be an RFC 3339 date-time (the provider form is deliberately not echoed).`
    )
  }
  return parsed.toISOString()
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new UnparseableDocumentError(`${label} is required`)
  }
  return value as Record<string, unknown>
}

function requireCount(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new UnparseableDocumentError(`${label} must be a non-negative integer`)
  }
  return value
}

/**
 * Parse an IG-§10.9-shaped Nebras tax invoice.
 *
 * Sections declare their own `vat_treatment`, which is what allows one document to carry both fee
 * streams: Hub sections `exclusive`, underlying-LFI sections `inclusive`. A section may also declare
 * `cost_recipient_type`/`cost_recipient_id`; absent that, the line's mapped category decides, and a
 * line whose category is unmapped defaults to the Hub as issuer of the invoice.
 */
export function parseNebrasTaxInvoice(
  input: unknown,
  map: NebrasCategoryMap = NEBRAS_CATEGORY_MAP
): ParsedTppCostDocument {
  const doc = requireObject(input, 'document')

  const documentReference = requireString(doc, 'invoice_number', 'invoice_number')
  const billingPeriod = requireString(doc, 'billing_period', 'billing_period')
  if (!PERIOD.test(billingPeriod)) {
    // The provider value is deliberately NOT echoed, matching every other refusal in this module.
    // This was the one path that reflected a provider-supplied string back across the API boundary,
    // which would carry an identifier shape straight out if a document ever put one here.
    throw new UnparseableDocumentError('billing_period must be YYYY-MM')
  }
  const currency = requireString(doc, 'currency', 'currency')
  if (currency !== 'AED') {
    throw new UnparseableDocumentError(
      'currency must be AED: a non-AED payable cannot be stored in a ledger with no deletion path. (The provider value is deliberately not echoed.)'
    )
  }
  const issuedAt = requireIsoDateTime(doc, 'issued_at')

  const issuer = requireObject(doc.issuer, 'issuer')
  const recipient = requireObject(doc.recipient, 'recipient')
  const issuerId = requireString(issuer, 'id', 'issuer.id')
  const issuerTrn = requireString(issuer, 'trn', 'issuer.trn (TRN)')
  const recipientId = requireString(recipient, 'id', 'recipient.id')
  const recipientTrn = requireString(recipient, 'trn', 'recipient.trn (TRN)')

  assertIdentifierFieldsClean({
    invoice_number: documentReference,
    'issuer.id': issuerId,
    'issuer.trn': issuerTrn,
    'recipient.id': recipientId,
    'recipient.trn': recipientTrn
  })

  const sections = doc.sections
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new UnparseableDocumentError('document must carry at least one section')
  }

  const lines: ParsedTppCostDocumentLine[] = []
  for (const [sectionIndex, rawSection] of sections.entries()) {
    const section = requireObject(rawSection, 'section')
    const treatment = section.vat_treatment
    if (treatment !== 'exclusive' && treatment !== 'inclusive') {
      throw new UnparseableDocumentError(
        'section vat_treatment must be exclusive or inclusive (ADR 0007 D4).'
      )
    }
    // Validated, not cast. Every other provider-supplied discriminator here is checked
    // (vat_treatment, currency, document_type at the service) and this one was an unchecked cast, so a
    // section saying "third_party" either reached the wire in a contract-declared enum field or hit the
    // column CHECK as an unmapped 5xx instead of the 422 every other malformed field gets.
    const rawRecipientType = section.cost_recipient_type
    if (rawRecipientType !== undefined
      && rawRecipientType !== 'nebras' && rawRecipientType !== 'underlying_lfi') {
      throw new UnparseableDocumentError(
        'section cost_recipient_type must be nebras or underlying_lfi.'
      )
    }
    const sectionRecipientType = rawRecipientType as CostRecipientType | undefined
    const sectionLines = section.lines
    if (!Array.isArray(sectionLines) || sectionLines.length === 0) {
      throw new UnparseableDocumentError('section must carry at least one line')
    }

    for (const [lineIndex, rawLine] of sectionLines.entries()) {
      // Ordinal, not `line_ref`. The refusal still has to say WHICH line so a finance operator can
      // act on a several-hundred-line invoice, but the position is ours (derived from the document
      // structure) whereas `line_ref` is a free-text provider string that can carry customer detail
      // — and this message is surfaced verbatim in the 422 envelope, ahead of any redaction.
      const at = `section ${sectionIndex + 1}, line ${lineIndex + 1}`
      const line = requireObject(rawLine, 'line')
      const lineRef = requireString(line, 'line_ref', 'line.line_ref')
      const sourceCategory = requireString(line, 'category', 'line.category')
      const units = requireCount(line.units, 'line.units')
      // These three become structured columns, so they cannot be redacted — only refused.
      assertIdentifierFieldsClean({
        'line.line_ref': lineRef,
        'line.category': sourceCategory,
        'line.cost_recipient_id': typeof line.cost_recipient_id === 'string' ? line.cost_recipient_id : undefined
      })
      const mapped = mapSourceCategory(map, sourceCategory)

      let split: VatSplit
      let unitPriceMilliFils: number
      if (treatment === 'exclusive') {
        // Hub layout: unit price is a net scheme rate in fils, possibly fractional (2.5, 0.5).
        const unitPriceFils = line.unit_price_fils
        if (typeof unitPriceFils !== 'number' || !Number.isFinite(unitPriceFils) || unitPriceFils < 0) {
          throw new UnparseableDocumentError(`${at} must carry a non-negative unit_price_fils`)
        }
        unitPriceMilliFils = fils(unitPriceFils)
        split = splitVatExclusive(unitPriceMilliFils * units)
      } else {
        // LFI layout: the stated amount is gross and carries VAT at 5/105.
        const grossFils = line.gross_fils
        if (typeof grossFils !== 'number' || !Number.isFinite(grossFils) || grossFils < 0) {
          throw new UnparseableDocumentError(`${at} must carry a non-negative gross_fils`)
        }
        split = splitVatInclusive(fils(grossFils))
        unitPriceMilliFils = units > 0 ? divideHalfUp(split.netMilliFils, units) : 0
      }

      lines.push({
        lineRef,
        sourceCategory,
        feeClass: mapped.feeClass,
        mapped: mapped.mapped,
        costRecipientType: sectionRecipientType ?? mapped.costRecipientType ?? 'nebras',
        costRecipientId: typeof line.cost_recipient_id === 'string' ? line.cost_recipient_id : issuerId,
        units,
        unitPriceMilliFils,
        actualNetMilliFils: split.netMilliFils,
        vatMilliFils: split.vatMilliFils,
        actualGrossMilliFils: split.grossMilliFils
      })
    }
  }

  const netMilliFils = lines.reduce((sum, line) => sum + line.actualNetMilliFils, 0)
  const vatMilliFils = lines.reduce((sum, line) => sum + line.vatMilliFils, 0)
  const grossMilliFils = lines.reduce((sum, line) => sum + line.actualGrossMilliFils, 0)

  // If the provider states a total, it must agree with its own lines. Preferring either side
  // silently would either hide a provider error or hide a parsing error.
  if (doc.total !== undefined) {
    const total = requireObject(doc.total, 'total')
    const statedNet = fils(requireCount(total.taxable_fils, 'total.taxable_fils'))
    const statedGross = fils(requireCount(total.gross_fils, 'total.gross_fils'))
    if (statedNet !== netMilliFils || statedGross !== grossMilliFils) {
      throw new UnparseableDocumentError(
        `document total does not reconcile with its lines: stated net ${statedNet} / gross ${statedGross}, `
        + `lines net ${netMilliFils} / gross ${grossMilliFils}`
      )
    }
  }

  const { redacted, removedPaths } = redactProviderPayload(input)

  return {
    documentType: 'nebras_tax_invoice',
    issuerId,
    issuerTrn,
    recipientId,
    recipientTrn,
    documentReference,
    billingPeriod,
    currency: 'AED',
    issuedAt,
    dueAt: typeof doc.due_at === 'string' ? doc.due_at : null,
    netMilliFils,
    vatMilliFils,
    grossMilliFils,
    lines,
    payload: redacted,
    redactedFieldCount: removedPaths.length,
    redactedPaths: removedPaths,
    unmappedLineCount: lines.filter((line) => !line.mapped).length
  }
}

/** The Nebras tax-invoice parser as a {@link TppCostDocumentParser}. */
export const nebrasTaxInvoiceParser: TppCostDocumentParser = {
  documentType: 'nebras_tax_invoice',
  parse: (input) => parseNebrasTaxInvoice(input)
}
