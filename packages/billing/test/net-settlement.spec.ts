import { describe, expect, it } from 'vitest'
import { decomposeNetSettlement, settlementResidueBreaks } from '../src/payable-accounting.js'

/**
 * BILL-16 criterion 4 — IG v5.0 §10.16 dual-role net settlement.
 *
 * The scheme nets amounts payable to LFIs against fees owed to Nebras where the LFI also operates as
 * a TPP. Two properties matter more than the arithmetic:
 *
 * 1. Netting is REPORTED, not applied. ADR 0007 keeps both role ledgers gross and nets only at
 *    settlement, so each position stays on the wire as its own signed line and `nettedMilliFils`
 *    states how much cancelled. An auditor asking why a receivable did not arrive as cash gets the
 *    answer from the row.
 * 2. An unexplained residue posts to suspense AND raises an E1 break. The suspense line alone
 *    balances the batch, and a balanced batch reads as finished — which leaves money nobody can
 *    explain with no owner, no clock and no resolution path.
 */

const PERIOD = '2026-06'

/** One dual-role counterparty (TPP and underlying LFI) plus the Hub. */
function positions() {
  return [
    {
      counterpartyId: 'fintech-alpha',
      receivableMilliFils: 5_000_000,
      payableMilliFils: 2_000_000,
      costRecipientType: 'underlying_lfi' as const,
      receivableLedgerRefs: ['INV-ALPHA-06'],
      payableLedgerRefs: ['LFI-ALPHA-06']
    },
    {
      counterpartyId: 'nebras',
      receivableMilliFils: 0,
      payableMilliFils: 1_000_000,
      costRecipientType: 'nebras' as const,
      receivableLedgerRefs: [],
      payableLedgerRefs: ['NEB-INV-06']
    }
  ]
}

describe('decomposeNetSettlement — the §10.16 offset', () => {
  it('nets a dual-role counterparty and says how much cancelled', () => {
    const result = decomposeNetSettlement({
      settlementReference: 'SET-2026-06',
      period: PERIOD,
      // 5,000,000 receivable − 2,000,000 LFI − 1,000,000 Hub = 2,000,000 expected.
      receivedMilliFils: 2_000_000,
      positions: positions()
    })

    expect(result.grossReceivableMilliFils).toBe(5_000_000)
    expect(result.underlyingLfiCostMilliFils).toBe(2_000_000)
    expect(result.nebrasCostMilliFils).toBe(1_000_000)
    expect(result.expectedNetMilliFils).toBe(2_000_000)
    expect(result.residueMilliFils).toBe(0)
    expect(result.break).toBeNull()

    const alpha = result.counterparties.find((c) => c.counterpartyId === 'fintech-alpha')!
    expect(alpha.dualRole).toBe(true)
    // The smaller side is what never moves as cash.
    expect(alpha.nettedMilliFils).toBe(2_000_000)
    expect(alpha.netMilliFils).toBe(3_000_000)
    expect(result.totalNettedMilliFils).toBe(2_000_000)

    // The Hub is not dual-role: we owe it, it owes us nothing.
    const hub = result.counterparties.find((c) => c.counterpartyId === 'nebras')!
    expect(hub.dualRole).toBe(false)
    expect(hub.nettedMilliFils).toBe(0)
  })

  it('keeps BOTH role ledgers gross on the lines it emits', () => {
    // ADR 0007: netting at settlement only. Collapsing the pair into one 3,000,000 line would lose
    // the fact that AED 2,000 of cost was incurred and AED 5,000 of revenue earned.
    const result = decomposeNetSettlement({
      settlementReference: 'SET-2026-06',
      period: PERIOD,
      receivedMilliFils: 2_000_000,
      positions: positions()
    })
    const receivable = result.lines.filter((l) => l.role === 'lfi_receivable')
    const payable = result.lines.filter((l) => l.role === 'tpp_of_record_payable')
    expect(receivable.reduce((s, l) => s + l.signedMilliFils, 0)).toBe(5_000_000)
    // Payables are carried negative — the sign convention settlementJournal already reads.
    expect(payable.reduce((s, l) => s + l.signedMilliFils, 0)).toBe(-3_000_000)
  })

  it('carries an approved adjustment into the expected position', () => {
    const result = decomposeNetSettlement({
      settlementReference: 'SET-2026-06',
      period: PERIOD,
      receivedMilliFils: 1_950_000,
      positions: positions(),
      adjustments: [{
        adjustmentRef: 'ADJ-1',
        signedMilliFils: -50_000,
        approvalRequestId: 'apr-adj-1',
        reason: 'accepted rate variance on the corporate payment category'
      }]
    })
    expect(result.approvedAdjustmentMilliFils).toBe(-50_000)
    expect(result.expectedNetMilliFils).toBe(1_950_000)
    // The adjustment EXPLAINS the shortfall, so no break — that is the whole point of approving it.
    expect(result.residueMilliFils).toBe(0)
    expect(result.break).toBeNull()
  })

  it('REFUSES an adjustment that cites no approval', () => {
    // "Approved adjustments" is the category. An unapproved one would let a desk make a residue
    // disappear by asserting it away, which is the opposite of what the break exists for.
    expect(() => decomposeNetSettlement({
      settlementReference: 'SET-2026-06',
      period: PERIOD,
      receivedMilliFils: 2_000_000,
      positions: positions(),
      adjustments: [{ adjustmentRef: 'ADJ-1', signedMilliFils: -50_000, approvalRequestId: '  ', reason: 'x' }]
    })).toThrow(/cites no approval/)
  })

  it('REFUSES a counterparty split across two positions', () => {
    // Two rows for one id would each net against nothing and the offset would silently not happen —
    // the exact failure §10.16 is about, arriving as a data-shape accident rather than a decision.
    const [alpha, hub] = positions()
    expect(() => decomposeNetSettlement({
      settlementReference: 'SET-2026-06',
      period: PERIOD,
      receivedMilliFils: 2_000_000,
      positions: [alpha!, { ...alpha!, receivableMilliFils: 0, payableMilliFils: 1 }, hub!]
    })).toThrow(/at most once/)
  })

  it('ignores a sub-tolerance residue rather than training the desk to close breaks unread', () => {
    const result = decomposeNetSettlement({
      settlementReference: 'SET-2026-06',
      period: PERIOD,
      receivedMilliFils: 2_000_000 - 400,
      positions: positions()
    })
    expect(result.residueMilliFils).toBe(-400)
    expect(result.break).toBeNull()
  })
})

describe('the residue scenario produces the suspense line AND a reconciliation break', () => {
  it('raises an E1 break citing both role ledgers', () => {
    const decomposition = decomposeNetSettlement({
      settlementReference: 'SET-2026-06',
      period: PERIOD,
      // 15,000 milli-fils short — 15 fils, well over the one-fil tolerance.
      receivedMilliFils: 2_000_000 - 15_000,
      positions: positions()
    })
    expect(decomposition.break).not.toBeNull()

    const breaks = settlementResidueBreaks([decomposition])
    expect(breaks).toHaveLength(1)
    const raised = breaks[0]!
    expect(raised.lineType).toBe('payment_settlement')
    expect(raised.status).toBe('flagged')
    expect(raised.period).toBe(PERIOD)
    // Money, signed, integer minor units — 15,000 milli-fils short is 15 fils short.
    expect(raised.varianceAmount).toEqual({ amount: -15, currency: 'AED' })
    // Both sides of the match are cited, which is what makes it investigable rather than a number.
    expect(raised.sourceARef).toContain('INV-ALPHA-06')
    expect(raised.sourceBRef).toContain('NEB-INV-06')
    expect(raised.sourceCRef).toBe('SET-2026-06')
  })

  it('derives the break amount exactly as the ledger derives it', () => {
    // Rounding the residue directly does NOT agree with the ledger, which derives it as a difference
    // of separately-rounded totals. A break citing a figure the ledger does not hold sends the desk
    // chasing a number that appears nowhere.
    const decomposition = decomposeNetSettlement({
      settlementReference: 'SET-ODD',
      period: PERIOD,
      receivedMilliFils: 9_998_500,
      positions: [{
        counterpartyId: 'fintech-beta',
        receivableMilliFils: 10_000_000,
        payableMilliFils: 0,
        costRecipientType: 'underlying_lfi',
        receivableLedgerRefs: ['INV-BETA-06'],
        payableLedgerRefs: []
      }]
    })
    expect(decomposition.residueMilliFils).toBe(-1_500)

    const [raised] = settlementResidueBreaks([decomposition])
    // -1500 milli-fils rounds DIRECTLY to -2 fils; the ledger posts -1, because 9,998,500 rounds up
    // to 9999 fils before the subtraction. The break must agree with the ledger.
    expect(raised!.varianceAmount.amount).toBe(-1)
  })

  it('raises nothing when the settlement reconciles', () => {
    const breaks = settlementResidueBreaks([decomposeNetSettlement({
      settlementReference: 'SET-CLEAN',
      period: PERIOD,
      receivedMilliFils: 2_000_000,
      positions: positions()
    })])
    expect(breaks).toEqual([])
  })
})
