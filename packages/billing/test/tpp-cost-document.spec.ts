import { describe, expect, it } from 'vitest'
import {
  NEBRAS_CATEGORY_MAP,
  UnparseableDocumentError,
  fils,
  mapSourceCategory,
  parseNebrasTaxInvoice,
  redactProviderPayload,
  splitVatExclusive,
  splitVatInclusive
} from '../src/index.js'

/**
 * BILL-14 — provider cost-document parsing (ADR 0007 D9, IG v5.0 §10).
 *
 * The properties that matter beyond "it parses": VAT is split by STREAM (Hub sections are
 * VAT-exclusive, LFI charges VAT-inclusive), per-line amounts must reconstruct the provider's own
 * subtotals and total, an unmapped provider category is FLAGGED rather than dropped, and customer
 * detail is removed before anything can be persisted — the cost tables have no deletion path.
 *
 * Identifier-shaped fixtures below use the synthetic forms the repo's PII guard mandates: the 999
 * national-identifier prefix, never the real 784, and IBAN bank code 000. That is a hard stop, and
 * it also forces the redactor to key on the identifier SHAPE rather than on a literal prefix or bank
 * code — which is precisely what makes it catch a real value it has never seen.
 */

const SYNTHETIC_IBAN = 'AE070001234567890123456'
const SYNTHETIC_NATIONAL_ID = '999-1990-1234567-1'

/** An IG-§10.9-shaped invoice: a Hub section priced VAT-exclusive with Taxable/VAT/Gross columns. */
function hubInvoice(overrides: Record<string, unknown> = {}) {
  return {
    invoice_number: 'NEB-2026-06-000123',
    billing_period: '2026-06',
    currency: 'AED',
    issuer: { id: 'NEBRAS', trn: '100123456700003' },
    recipient: { id: 'bank-as-tpp', trn: '100987654300003' },
    issued_at: '2026-07-03T00:00:00.000Z',
    due_at: '2026-07-10T00:00:00.000Z',
    sections: [
      {
        name: 'Service Initiation',
        vat_treatment: 'exclusive',
        lines: [
          { line_ref: 'SI-1', category: 'Payment Initiation', units: 1000, unit_price_fils: 2.5 }
        ]
      },
      {
        name: 'Data Sharing',
        vat_treatment: 'exclusive',
        lines: [
          { line_ref: 'DS-1', category: 'Bank Data Sharing', units: 400, unit_price_fils: 0.5 }
        ]
      }
    ],
    ...overrides
  }
}

describe('BILL-14 VAT split by fee stream (ADR 0007 D4)', () => {
  it('treats a Hub amount as VAT-exclusive: 5% is added on top', () => {
    // 2500 fils net → 125 fils VAT → 2625 fils gross.
    expect(splitVatExclusive(fils(2500))).toEqual({
      netMilliFils: fils(2500), vatMilliFils: fils(125), grossMilliFils: fils(2625)
    })
  })

  it('treats a TPP-to-LFI amount as VAT-inclusive: 5/105 is carved out', () => {
    // 2625 fils gross → 125 fils VAT → 2500 fils net. The exact inverse of the Hub case.
    expect(splitVatInclusive(fils(2625))).toEqual({
      netMilliFils: fils(2500), vatMilliFils: fils(125), grossMilliFils: fils(2625)
    })
  })

  it('keeps gross = net + vat under half-up rounding, for both treatments', () => {
    for (const amount of [1, 7, 13, 999, 1001, 123457]) {
      const inclusive = splitVatInclusive(amount)
      expect(inclusive.netMilliFils + inclusive.vatMilliFils).toBe(inclusive.grossMilliFils)
      const exclusive = splitVatExclusive(amount)
      expect(exclusive.netMilliFils + exclusive.vatMilliFils).toBe(exclusive.grossMilliFils)
    }
  })
})

describe('BILL-14 provider category mapping', () => {
  it('maps the categories the IG evidences, to the fee classes we already price', () => {
    const mapped = mapSourceCategory(NEBRAS_CATEGORY_MAP, 'Payment Initiation')
    expect(mapped).toMatchObject({ mapped: true, feeClass: 'hub.standard', costRecipientType: 'nebras' })
  })

  it('FLAGS an unknown category rather than dropping it or guessing a fee class', () => {
    const unknown = mapSourceCategory(NEBRAS_CATEGORY_MAP, 'Some New Scheme Category')
    expect(unknown).toMatchObject({ mapped: false, feeClass: null })
    // The provider's own wording survives as evidence even when we cannot map it.
    expect(unknown.sourceCategory).toBe('Some New Scheme Category')
  })

  it('leaves the two discounted categories deliberately unmapped pending BD-20', () => {
    // The IG §10.9 sample carries a CoP unit anomaly (0.25 vs 0.005); mapping them now would
    // mis-state the payable, so they must surface as unmapped rather than resolve to a guess.
    for (const category of ['Balance (Discounted)', 'CoP (Discounted)']) {
      expect(mapSourceCategory(NEBRAS_CATEGORY_MAP, category).mapped).toBe(false)
    }
  })

  it('is versioned data citing its source, so a corrected mapping does not need a code change', () => {
    expect(NEBRAS_CATEGORY_MAP.version).toMatch(/^\d{4}\.\d{2}\.\d{2}$/)
    // The mapping is only auditable if it says which documents it was derived from.
    expect(NEBRAS_CATEGORY_MAP.source).toMatch(/Interaction Guide/)
    expect(NEBRAS_CATEGORY_MAP.source).toMatch(/Pricing Model/)
  })
})

describe('BILL-14 Nebras tax-invoice parsing', () => {
  it('parses an IG-10.9-shaped invoice whose lines reconstruct both subtotals and the total', () => {
    const parsed = parseNebrasTaxInvoice(hubInvoice())

    expect(parsed.documentType).toBe('nebras_tax_invoice')
    expect(parsed.documentReference).toBe('NEB-2026-06-000123')
    expect(parsed.currency).toBe('AED')
    expect(parsed.lines).toHaveLength(2)

    // Service Initiation: 1000 × 2.5 fils = 2500 fils net, +5% = 2625 gross.
    expect(parsed.lines.find((line) => line.lineRef === 'SI-1')).toMatchObject({
      sourceCategory: 'Payment Initiation', feeClass: 'hub.standard', mapped: true,
      actualNetMilliFils: fils(2500), vatMilliFils: fils(125), actualGrossMilliFils: fils(2625)
    })

    // Data Sharing: 400 × 0.5 fils = 200 fils net, +5% = 210 gross.
    expect(parsed.lines.find((line) => line.lineRef === 'DS-1')).toMatchObject({
      actualNetMilliFils: fils(200), vatMilliFils: fils(10), actualGrossMilliFils: fils(210)
    })

    // The document totals are the sum of its lines, not a separately trusted number.
    expect(parsed.netMilliFils).toBe(fils(2700))
    expect(parsed.vatMilliFils).toBe(fils(135))
    expect(parsed.grossMilliFils).toBe(fils(2835))
  })

  it('refuses an invoice whose stated total contradicts its own lines', () => {
    // A provider total that does not equal the lines is not something to silently prefer either way.
    const tampered = hubInvoice({ total: { taxable_fils: 9999, vat_fils: 500, gross_fils: 10499 } })
    expect(() => parseNebrasTaxInvoice(tampered)).toThrow(UnparseableDocumentError)
    expect(() => parseNebrasTaxInvoice(tampered)).toThrow(/total/i)
  })

  it('parses an LFI-charges component with VAT carved out of the stated gross', () => {
    const withLfi = hubInvoice({
      sections: [
        ...hubInvoice().sections,
        {
          name: 'Underlying LFI Charges',
          vat_treatment: 'inclusive',
          cost_recipient_type: 'underlying_lfi',
          lines: [
            {
              line_ref: 'LFI-1', category: 'Corporate Data', units: 100,
              cost_recipient_id: 'lfi-alpha', gross_fils: 2625
            }
          ]
        }
      ]
    })
    const parsed = parseNebrasTaxInvoice(withLfi)

    // Inclusive: 2625 gross carries 125 VAT, leaving 2500 net — NOT 2625 net + 131 VAT.
    expect(parsed.lines.find((line) => line.lineRef === 'LFI-1')).toMatchObject({
      costRecipientType: 'underlying_lfi', costRecipientId: 'lfi-alpha',
      actualNetMilliFils: fils(2500), vatMilliFils: fils(125), actualGrossMilliFils: fils(2625)
    })
  })

  it('rejects a non-AED document rather than storing a mis-denominated payable', () => {
    expect(() => parseNebrasTaxInvoice(hubInvoice({ currency: 'USD' }))).toThrow(/AED/)
  })

  it('requires the IG header fields, including both TRNs and the billing period', () => {
    for (const missing of ['invoice_number', 'billing_period', 'issued_at']) {
      const doc = hubInvoice()
      delete (doc as Record<string, unknown>)[missing]
      expect(() => parseNebrasTaxInvoice(doc), missing).toThrow(UnparseableDocumentError)
    }
    expect(() => parseNebrasTaxInvoice(hubInvoice({ issuer: { id: 'NEBRAS' } }))).toThrow(/trn/i)
  })
})

describe('BILL-14 redaction at parse time', () => {
  /**
   * The hard requirement (BILL-13 migration 0039 header): these columns are INSERT-only with no
   * deletion path, so customer detail must be removed BEFORE the first insert. Redaction keys on
   * both field names and value SHAPES, because provider field names are not ours to control.
   */
  it('removes customer detail by key name, by value shape, and at any depth', () => {
    const payload = {
      invoice_number: 'NEB-1',
      lines: [{
        category: 'Payment Initiation',
        // Key-named PSU fields.
        customer_name: 'REDACT_BY_KEY_NAME',
        psu_id: 'psu-abc',
        beneficiary: { account_name: 'REDACT_NESTED', mobile: '+971500000000' },
        // Value-shaped: an IBAN and a national-identifier shape under innocuous keys.
        reference: SYNTHETIC_IBAN,
        note: SYNTHETIC_NATIONAL_ID,
        // Legitimate operational data that must SURVIVE.
        units: 1000,
        unit_price_fils: 2.5
      }]
    }

    const { redacted, removedPaths } = redactProviderPayload(payload)
    const serialised = JSON.stringify(redacted)

    for (const secret of [
      'REDACT_BY_KEY_NAME', 'psu-abc', 'REDACT_NESTED', '+971500000000',
      SYNTHETIC_IBAN, SYNTHETIC_NATIONAL_ID
    ]) {
      expect(serialised, `leaked ${secret}`).not.toContain(secret)
    }
    // Operational data is untouched — redaction must not gut the evidence.
    expect(serialised).toContain('1000')
    expect(serialised).toContain('NEB-1')

    // Key PATHS are reported so the audit can show redaction happened, and WHY each one went. Named
    // rather than counted: a count would pass on the wrong five paths.
    const report = removedPaths.join('|')
    expect(report).toMatch(/lines\[0\]\.customer_name \(key\)/)
    expect(report).toMatch(/lines\[0\]\.psu_id \(key\)/)
    // A PSU-named object is removed whole rather than descended into — so its children need no
    // separate entries, and nothing under it can survive by having an innocuous key.
    expect(report).toMatch(/lines\[0\]\.beneficiary \(key\)/)
    expect(report).toMatch(/lines\[0\]\.reference \(iban\)/)
    expect(report).toMatch(/lines\[0\]\.note \(national-id\)/)

    // ...but the removed VALUES are never carried in the report itself.
    expect(JSON.stringify(removedPaths)).not.toContain('REDACT_BY_KEY_NAME')
    expect(JSON.stringify(removedPaths)).not.toContain(SYNTHETIC_IBAN)
  })

  it('leaves the invoice TRNs alone — they are required tax evidence, not customer detail', () => {
    // A UAE TRN is 15 digits. An earlier draft carried a generic "long digit run" rule that redacted
    // both TRNs out of every invoice header, destroying a field IG §10.9 requires and inflating the
    // redaction count. Business identifiers must survive redaction.
    const parsed = parseNebrasTaxInvoice(hubInvoice())
    expect(parsed.issuerTrn).toBe('100123456700003')
    expect(parsed.recipientTrn).toBe('100987654300003')
    expect(JSON.stringify(parsed.payload)).toContain('100123456700003')
    expect(parsed.redactedFieldCount).toBe(0)
  })

  it('REFUSES a document carrying customer detail in a structured identifier column', () => {
    // Redaction cannot help these fields: line_ref is part of a UNIQUE key and category is the
    // evidence a fee-class mapping derives from, so a marker would destroy identity rather than
    // protect anyone. In a ledger with no deletion path, refusing the upload is the safer answer.
    // An earlier version of this parser redacted the payload only and let these columns through.
    const cases: Array<[string, Record<string, unknown>]> = [
      ['line_ref', { line_ref: SYNTHETIC_IBAN, category: 'Payment Initiation', units: 1, unit_price_fils: 2.5 }],
      ['category', { line_ref: 'SI-2', category: SYNTHETIC_NATIONAL_ID, units: 1, unit_price_fils: 2.5 }],
      ['cost_recipient_id', { line_ref: 'SI-3', category: 'Payment Initiation', units: 1, unit_price_fils: 2.5, cost_recipient_id: SYNTHETIC_IBAN }]
    ]
    for (const [field, line] of cases) {
      expect(() => parseNebrasTaxInvoice(hubInvoice({
        sections: [{ name: 'Service Initiation', vat_treatment: 'exclusive', lines: [line] }]
      })), field).toThrow(UnparseableDocumentError)
    }
  })

  it('refuses customer detail in the document header identifiers too', () => {
    expect(() => parseNebrasTaxInvoice(hubInvoice({ invoice_number: SYNTHETIC_IBAN })))
      .toThrow(/structured column/i)
    expect(() => parseNebrasTaxInvoice(hubInvoice({ issuer: { id: SYNTHETIC_NATIONAL_ID, trn: '100123456700003' } })))
      .toThrow(/structured column/i)
  })

  it('never echoes the offending provider value in the refusal message', () => {
    // The refusal must not itself become the leak — the message crosses the API boundary as a 422.
    try {
      parseNebrasTaxInvoice(hubInvoice({ invoice_number: SYNTHETIC_IBAN }))
      throw new Error('expected a refusal')
    } catch (error) {
      expect((error as Error).message).not.toContain(SYNTHETIC_IBAN)
      expect((error as Error).message).toMatch(/deliberately not echoed/i)
    }
  })

  it('is IDEMPOTENT: re-redacting an already-redacted payload reports nothing new', () => {
    // Load-bearing, not cosmetic. The store re-runs the redactor as a boundary check before an
    // unremovable INSERT and treats "reported something" as "this was never redacted". Replacing a
    // PSU-named field keeps its key, so without this property every already-clean payload would look
    // unredacted and the check would reject correct writes — which is exactly what it did first time.
    const payload = { lines: [{ customer_name: 'X', beneficiary: { mobile: '+971500000000' }, units: 3 }] }

    const first = redactProviderPayload(payload)
    expect(first.removedPaths.length).toBeGreaterThan(0)

    const second = redactProviderPayload(first.redacted)
    expect(second.removedPaths).toEqual([])
    expect(JSON.stringify(second.redacted)).toBe(JSON.stringify(first.redacted))
  })

  it('is applied by the parser itself, so an unredacted payload cannot reach a caller', () => {
    const parsed = parseNebrasTaxInvoice(hubInvoice({
      sections: [{
        name: 'Service Initiation', vat_treatment: 'exclusive',
        lines: [{
          line_ref: 'SI-1', category: 'Payment Initiation', units: 10, unit_price_fils: 2.5,
          payer_name: 'LEAKED_NAME', iban: SYNTHETIC_IBAN
        }]
      }]
    }))

    expect(JSON.stringify(parsed.payload)).not.toContain('LEAKED_NAME')
    expect(JSON.stringify(parsed.payload)).not.toContain(SYNTHETIC_IBAN)
    expect(parsed.redactedFieldCount).toBeGreaterThan(0)
  })
})
