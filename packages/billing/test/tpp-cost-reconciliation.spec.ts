import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PAYABLE_MATERIALITY_MILLI_FILS,
  DEFAULT_PAYABLE_TOLERANCE_MILLI_FILS,
  isPayableBreakMaterial,
  NEBRAS_QUERY_WINDOW_DAYS,
  fils,
  payableBreakToLineType,
  reconcilePayable,
  type ParsedTppCostDocumentLine
} from '../src/index.js'

/**
 * BILL-15 — three-way payable reconciliation (ADR 0007, IG v5.0 §10.13/§10.17).
 *
 * Own metering → expected statement → provider document, matched at the invoice-category grain with an
 * explicit tolerance. Expected values are milli-fils and documents arrive in fils, so exact equality is
 * never the test; the tolerance is what makes a match meaningful.
 *
 * The properties worth pinning beyond "it matches": each variance resolves to the RIGHT break class
 * (a quantity difference is not a rate difference, and mis-classifying one sends the dispute to the
 * wrong evidence), a penalty is only expected when a late payment actually happened, and a charge
 * appearing on both the Nebras invoice and an LFI self-invoice is itself a break rather than counted
 * twice.
 */

const PERIOD = '2026-06'

/** An expected statement line, at the grain reconciliation matches on. */
function expectedLine(overrides: Record<string, unknown> = {}) {
  return {
    lineRef: 'nebras|NEBRAS|hub|hub.standard|payments|payments|unclassified||',
    costRecipientType: 'nebras' as const,
    costRecipientId: 'NEBRAS',
    feeStream: 'hub' as const,
    feeClass: 'hub.standard' as const,
    productFamily: 'payments' as const,
    apiFamily: 'payments',
    customerSegment: 'unclassified' as const,
    units: 1000,
    events: 1000,
    vatTreatment: 'exclusive' as const,
    expectedNetMilliFils: fils(2500),
    vatMilliFils: fils(125),
    expectedGrossMilliFils: fils(2625),
    eventIds: ['evt-1'],
    fapiInteractionIds: ['fapi-1'],
    ...overrides
  }
}

function expectedStatement(lines = [expectedLine()]) {
  const net = lines.reduce((s, l) => s + (l.expectedNetMilliFils as number), 0)
  const vat = lines.reduce((s, l) => s + (l.vatMilliFils as number), 0)
  return {
    period: PERIOD,
    tenantId: '11111111-1111-4111-8111-111111111111',
    currency: 'AED' as const,
    rateCardVersion: '2026.06.02',
    evidence: {
      meterRunId: 'run-1',
      generatedAt: '2026-07-03T02:00:00.000Z',
      ratingRunAt: '2026-07-03T01:59:00.000Z',
      pricingEffectiveFrom: '2026-06-02',
      rateSnapshotHash: 'sha256:x'
    },
    totals: {
      nebrasHubNetMilliFils: net,
      underlyingLfiPaymentNetMilliFils: 0,
      underlyingLfiDataNetMilliFils: 0,
      totalNetMilliFils: net,
      totalVatMilliFils: vat,
      totalGrossMilliFils: net + vat
    },
    lines
  }
}

/** A provider document line as BILL-14's parser produces it. */
function docLine(overrides: Partial<ParsedTppCostDocumentLine> = {}): ParsedTppCostDocumentLine {
  return {
    lineRef: 'SI-1',
    sourceCategory: 'Payment Initiation',
    feeClass: 'hub.standard',
    mapped: true,
    costRecipientType: 'nebras',
    costRecipientId: 'NEBRAS',
    units: 1000,
    unitPriceMilliFils: fils(2.5),
    actualNetMilliFils: fils(2500),
    vatMilliFils: fils(125),
    actualGrossMilliFils: fils(2625),
    ...overrides
  }
}

function invoice(lines = [docLine()], overrides: Record<string, unknown> = {}) {
  return {
    documentId: 'doc-1',
    documentType: 'nebras_tax_invoice' as const,
    issuerId: 'NEBRAS',
    documentReference: 'NEB-1',
    billingPeriod: PERIOD,
    issuedAt: '2026-07-03T00:00:00.000Z',
    receivedAt: '2026-07-03T09:00:00.000Z',
    lines,
    ...overrides
  }
}

describe('BILL-15 three-way payable reconciliation', () => {
  it('matches clean when the document agrees with the expectation', () => {
    const result = reconcilePayable({ expected: expectedStatement(), documents: [invoice()] })

    expect(result.matchedLineCount).toBe(1)
    expect(result.breaks).toEqual([])
    expect(result.netVarianceMilliFils).toBe(0)
  })

  it('produces NO break for a difference inside the tolerance', () => {
    // Documents arrive in fils, expectations are milli-fils: sub-fil differences are rounding, not
    // disputes. The default tolerance is the fils(1) pattern.
    expect(DEFAULT_PAYABLE_TOLERANCE_MILLI_FILS).toBe(fils(1))
    const result = reconcilePayable({
      expected: expectedStatement(),
      documents: [invoice([docLine({
        actualNetMilliFils: fils(2500) + 400, actualGrossMilliFils: fils(2625) + 400
      })])]
    })
    expect(result.breaks).toEqual([])
    expect(result.matchedLineCount).toBe(1)
  })

  it('classifies an overcharge on the RATE as rate_variance, not quantity_variance', () => {
    // Same units, more money per unit: the dispute evidence is the applied rate.
    const result = reconcilePayable({
      expected: expectedStatement(),
      documents: [invoice([docLine({
        units: 1000,
        unitPriceMilliFils: fils(3),
        actualNetMilliFils: fils(3000),
        vatMilliFils: fils(150),
        actualGrossMilliFils: fils(3150)
      })])]
    })

    expect(result.breaks).toHaveLength(1)
    expect(result.breaks[0]).toMatchObject({
      breakType: 'rate_variance',
      presence: 'both',
      expectedNetMilliFils: fils(2500),
      actualNetMilliFils: fils(3000),
      varianceMilliFils: fils(500)
    })
    // Line-level evidence travels with the break, which is what makes it disputable.
    expect(result.breaks[0]!.eventIds).toEqual(['evt-1'])
  })

  it('classifies a units difference at the same rate as quantity_variance', () => {
    const result = reconcilePayable({
      expected: expectedStatement(),
      documents: [invoice([docLine({
        units: 1200,
        unitPriceMilliFils: fils(2.5),
        actualNetMilliFils: fils(3000),
        vatMilliFils: fils(150),
        actualGrossMilliFils: fils(3150)
      })])]
    })
    expect(result.breaks[0]).toMatchObject({ breakType: 'quantity_variance' })
  })

  it('classifies a VAT-only difference as vat_variance', () => {
    // Net agrees, VAT does not — a treatment error (exclusive vs inclusive), not a pricing dispute.
    const result = reconcilePayable({
      expected: expectedStatement(),
      documents: [invoice([docLine({
        vatMilliFils: fils(125) + fils(6), actualGrossMilliFils: fils(2625) + fils(6)
      })])]
    })
    expect(result.breaks[0]).toMatchObject({ breakType: 'vat_variance' })
  })

  it('raises missing_charge when we expected a charge the document omits', () => {
    const result = reconcilePayable({ expected: expectedStatement(), documents: [invoice([])] })
    expect(result.breaks[0]).toMatchObject({
      breakType: 'missing_charge', presence: 'expected_only', actualNetMilliFils: 0
    })
  })

  it('raises unexpected_charge for a document line we never expected', () => {
    const result = reconcilePayable({
      expected: expectedStatement([]),
      documents: [invoice([docLine()])]
    })
    expect(result.breaks[0]).toMatchObject({
      breakType: 'unexpected_charge', presence: 'document_only', expectedNetMilliFils: 0
    })
  })

  it('raises unmatched_document_line for a line whose category BILL-14 could not map', () => {
    // An unmapped category cannot be compared to anything, so it must surface as its own break class
    // rather than masquerade as an unexpected charge against a fee class we do price.
    const result = reconcilePayable({
      expected: expectedStatement([]),
      documents: [invoice([docLine({ sourceCategory: 'CoP (Discounted)', feeClass: null, mapped: false })])]
    })
    expect(result.breaks[0]).toMatchObject({
      breakType: 'unmatched_document_line', sourceCategory: 'CoP (Discounted)'
    })
  })

  it('raises wrong_recipient when the charge is right but the counterparty is not', () => {
    const result = reconcilePayable({
      expected: expectedStatement(),
      documents: [invoice([docLine({ costRecipientType: 'underlying_lfi', costRecipientId: 'lfi-alpha' })])]
    })
    const types = result.breaks.map((b) => b.breakType)
    expect(types).toContain('wrong_recipient')
  })

  it('pairs a wrong recipient into ONE break, not a missing charge plus an unexpected one', () => {
    // The pairing IS the control: two half-truths would open two queries against two counterparties
    // for a single charge, and neither would be answerable.
    const result = reconcilePayable({
      expected: expectedStatement(),
      documents: [invoice([docLine({ costRecipientType: 'underlying_lfi', costRecipientId: 'lfi-alpha' })])]
    })
    expect(result.breaks).toHaveLength(1)
    expect(result.breaks[0]).toMatchObject({ breakType: 'wrong_recipient', presence: 'both' })
  })

  it('refuses to guess the pairing when two document lines could be the wrong recipient', () => {
    // Nothing in the evidence says which of the two our expectation meant. Guessing would name the
    // wrong counterparty in the query, so it degrades to the two claims we can defend separately.
    const result = reconcilePayable({
      expected: expectedStatement(),
      documents: [invoice([
        docLine({ lineRef: 'A', costRecipientType: 'underlying_lfi', costRecipientId: 'lfi-alpha' }),
        docLine({ lineRef: 'B', costRecipientType: 'underlying_lfi', costRecipientId: 'lfi-beta' })
      ])]
    })
    const types = result.breaks.map((b) => b.breakType).sort()
    expect(types).toEqual(['missing_charge', 'unexpected_charge', 'unexpected_charge'])
  })

  it('raises duplicate_charge when the Hub invoice and an LFI self-invoice bill the same thing', () => {
    // The Nebras invoice reconciles both cost components (IG §10.2), so an LFI self-invoice repeating a
    // charge is a duplicate, not a second cost.
    const result = reconcilePayable({
      expected: expectedStatement(),
      documents: [
        invoice([docLine()]),
        invoice([docLine({ lineRef: 'LFI-1' })], {
          documentId: 'doc-2', documentType: 'lfi_self_invoice', issuerId: 'lfi-alpha', documentReference: 'LFI-1'
        })
      ]
    })
    expect(result.breaks.map((b) => b.breakType)).toContain('duplicate_charge')
    // The duplicate is money we HAVE been billed, so it must move the headline exposure. Counting the
    // primary line as matched and stopping there reports a net variance of zero on an invoice pair
    // that over-bills us by the full line — and that number is what BILL-16 decides to pay from.
    expect(result.matchedLineCount).toBe(1)
    expect(result.netVarianceMilliFils).toBe(fils(2500))
  })

  it('raises period_variance when a document line belongs to another period', () => {
    const result = reconcilePayable({
      expected: expectedStatement(),
      documents: [invoice([docLine()], { billingPeriod: '2026-05' })]
    })
    expect(result.breaks.map((b) => b.breakType)).toContain('period_variance')
  })
})

describe('BILL-15 late-payment penalty (IG v5.0 §10.17)', () => {
  const penalty = docLine({
    lineRef: 'PEN-1', sourceCategory: 'Late Payment Penalty', feeClass: null, mapped: false,
    units: 1, unitPriceMilliFils: fils(500), actualNetMilliFils: fils(500),
    vatMilliFils: fils(25), actualGrossMilliFils: fils(525)
  })

  it('raises unexpected_charge for a penalty with no late payment on record', () => {
    const result = reconcilePayable({
      expected: expectedStatement(),
      documents: [invoice([docLine(), penalty])]
    })
    const penaltyBreak = result.breaks.find((b) => b.sourceCategory === 'Late Payment Penalty')
    expect(penaltyBreak).toMatchObject({ breakType: 'unexpected_charge' })
  })

  it('matches a penalty clean when a late payment actually occurred', () => {
    const result = reconcilePayable({
      expected: expectedStatement(),
      documents: [invoice([docLine(), penalty])],
      latePayments: [{ period: PERIOD, occurredAt: '2026-07-15T00:00:00.000Z' }]
    })
    expect(result.breaks.find((b) => b.sourceCategory === 'Late Payment Penalty')).toBeUndefined()
    expect(result.penaltyLinesAccepted).toBe(1)
  })

  it('does not accept a penalty because some OTHER period was paid late', () => {
    const result = reconcilePayable({
      expected: expectedStatement(),
      documents: [invoice([docLine(), penalty])],
      latePayments: [{ period: '2026-05', occurredAt: '2026-06-15T00:00:00.000Z' }]
    })
    expect(result.breaks.find((b) => b.sourceCategory === 'Late Payment Penalty'))
      .toMatchObject({ breakType: 'unexpected_charge' })
  })
})

describe('BILL-15 dispute window (IG v5.0 §10.13)', () => {
  it('derives the deadline from the scheme-published window, which is CONFIG not a constant', () => {
    expect(NEBRAS_QUERY_WINDOW_DAYS).toBe(30)

    const standard = reconcilePayable({ expected: expectedStatement(), documents: [invoice()] })
    // 30 calendar days from occurrence — the invoice issue date by the BD-21 default.
    expect(standard.queryDeadline).toBe('2026-08-02T00:00:00.000Z')
    expect(standard.queryWindowStatus).toBe('open')

    // A bank whose agreement says otherwise can shorten or lengthen it without a code change.
    const configured = reconcilePayable({
      expected: expectedStatement(), documents: [invoice()], queryWindowDays: 10
    })
    expect(configured.queryDeadline).toBe('2026-07-13T00:00:00.000Z')
  })

  it('does not let an off-period document drag this period\'s deadline earlier', () => {
    // A 2026-05 invoice issued in June says nothing about when the June charges became queryable.
    // Letting it anchor silently shortens the window, and abandoning a live query early is as wrong
    // as missing a dead one.
    const result = reconcilePayable({
      expected: expectedStatement(),
      documents: [
        invoice([docLine()], {
          documentId: 'doc-2', documentReference: 'OLD', billingPeriod: '2026-05',
          issuedAt: '2026-06-03T00:00:00.000Z'
        }),
        invoice()
      ]
    })
    expect(result.queryDeadline).toBe('2026-08-02T00:00:00.000Z')
  })

  it('reports the window expired once the deadline has passed at ingest', () => {
    const result = reconcilePayable({
      expected: expectedStatement(),
      documents: [invoice([docLine()], { receivedAt: '2026-09-01T00:00:00.000Z' })]
    })
    expect(result.queryWindowStatus).toBe('expired')
    expect(result.daysRemainingAtIngest).toBeLessThan(0)
  })

  it('carries the Nebras response clocks so an open query shows what is owed and when', () => {
    const result = reconcilePayable({ expected: expectedStatement(), documents: [invoice()] })
    // IG §10.13: first response 10 minutes, final response 10 days, escalation review 15 days.
    expect(result.responseClocks).toMatchObject({
      firstResponseMinutes: 10, finalResponseDays: 10, escalationReviewDays: 15
    })
  })
})

describe('BILL-15 payable break_type → contract LineType (criterion 6a)', () => {
  /**
   * The contract classifies breaks by `LineType` (six values) and declares no `break_type`, so an
   * unmapped payable break is not representable on `GET /back-office/reconciliation/breaks` — the very
   * endpoint meant to show it. BILL-13 froze the ten-value taxonomy and deferred this mapping here.
   */
  it('maps every one of the ten payable break types onto a declared LineType', () => {
    const all = [
      'quantity_variance', 'rate_variance', 'unexpected_charge', 'missing_charge', 'wrong_recipient',
      'duplicate_charge', 'vat_variance', 'period_variance', 'unmatched_document_line',
      'unmatched_expected_line'
    ] as const
    const declared = [
      'nebras_fees', 'payment_settlement', 'consent_record', 'tpp_aas_pass_through',
      'lfi_access_log', 'dao_api_call'
    ]
    for (const breakType of all) {
      const lineType = payableBreakToLineType(breakType, 'nebras')
      expect(declared, `${breakType} → ${lineType}`).toContain(lineType)
    }
  })

  it('routes by cost recipient, because the same variance means a different line type per stream', () => {
    // A Hub fee variance is nebras_fees; the same variance against an underlying LFI is not.
    expect(payableBreakToLineType('rate_variance', 'nebras')).toBe('nebras_fees')
    expect(payableBreakToLineType('rate_variance', 'underlying_lfi')).not.toBe('nebras_fees')
  })
})

describe('BILL-15/16 payable-break materiality', () => {
  it('coincides with the tolerance at the DEFAULTS, so the gate stays conservative out of the box', () => {
    // Measured, not assumed: both defaults are one fil, so with no bank configuration every break
    // that exists at all is also material. Replacing the hardcoded `true` therefore changes no
    // default behaviour — what it changes is that the judgement is now DERIVED and configurable
    // instead of asserted, which is what let a sub-fil difference block a month before.
    expect(DEFAULT_PAYABLE_MATERIALITY_MILLI_FILS).toBe(DEFAULT_PAYABLE_TOLERANCE_MILLI_FILS)
    expect(isPayableBreakMaterial('rate_variance', fils(1) + 1)).toBe(true)
    expect(isPayableBreakMaterial('rate_variance', fils(2))).toBe(true)
  })

  it('opens a gap between "is a break" and "blocks the close" once a bank configures one', () => {
    // The gap the two constants exist to allow. Above the matching tolerance so a break EXISTS and
    // stays queryable inside the IG §10.13 window; below the bank's blocking threshold so it does
    // not refuse the month.
    const configured = fils(100)
    expect(isPayableBreakMaterial('rate_variance', fils(2), configured)).toBe(false)
  })

  it('treats the threshold as exclusive, so a variance exactly at it is immaterial', () => {
    expect(isPayableBreakMaterial('quantity_variance', fils(1))).toBe(false)
  })

  it('judges on absolute variance — an undercharge is as material as an overcharge', () => {
    expect(isPayableBreakMaterial('rate_variance', -fils(5))).toBe(true)
    expect(isPayableBreakMaterial('rate_variance', fils(5))).toBe(true)
  })

  it('holds a wrong recipient material at ZERO variance', () => {
    // Paying exactly the right amount to the wrong counterparty is not a rounding difference.
    // The spec's TppCostDiffLine.material description states this verbatim.
    expect(isPayableBreakMaterial('wrong_recipient', 0)).toBe(true)
  })

  it('honours a bank-configured threshold rather than only the default', () => {
    // AED 1.00 = 100 fils. A bank that only wants to stop the month for real money.
    const configured = fils(100)
    expect(isPayableBreakMaterial('vat_variance', fils(50), configured)).toBe(false)
    expect(isPayableBreakMaterial('vat_variance', fils(150), configured)).toBe(true)
  })

  it('does not confuse the milli-fils and fils vocabularies', () => {
    // The trap this constant exists to avoid: the E1 threshold for nebras_fees is `1` under
    // unit 'aed' (one FIL). Passing that 1 straight through as milli-fils would make anything above
    // a single milli-fil material — a thousand times too sensitive.
    expect(DEFAULT_PAYABLE_MATERIALITY_MILLI_FILS).toBe(1000)
    expect(isPayableBreakMaterial('rate_variance', 2, 1)).toBe(true)
    expect(isPayableBreakMaterial('rate_variance', 2, DEFAULT_PAYABLE_MATERIALITY_MILLI_FILS)).toBe(false)
  })
})
