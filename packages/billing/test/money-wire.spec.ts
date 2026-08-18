import { describe, expect, it } from 'vitest'
import { fils, toMinorUnitMoney, toWireMoneyTriple } from '../src/index.js'

/**
 * Money at the wire boundary (the ratified resolution of the milli-fils deviation).
 *
 * Milli-fils is a RATING AND STORAGE precision: ADR 0007 prices scheme tariffs at 2.5 and 0.5 fils,
 * which minor units cannot hold. The wire and the general ledger are both fils, per the binding
 * convention. This module owns the crossing.
 *
 * The trap it exists to close: rounding net, VAT and gross INDEPENDENTLY produces a triple that does
 * not tie. A consumer checking `net + vat === gross` — which the convention invites, and which the
 * document's own DB CHECK enforces — then sees a contract violation on perfectly good data.
 */

describe('toWireMoneyTriple', () => {
  it('derives gross from the rounded parts so the triple always ties', () => {
    // net 2500.5 fils and VAT 125.5 fils both round UP; independently rounding gross (2626.0) would
    // give 2626 against a parts-sum of 2627.
    const triple = toWireMoneyTriple(
      { netMilliFils: 2_500_500, vatMilliFils: 125_500, grossMilliFils: 2_626_000 },
      'AED'
    )
    expect(triple.net.amount + triple.vat.amount).toBe(triple.gross.amount)
    expect(triple.gross.amount).toBe(2627)
  })

  it('ties for every sub-fil combination, not just the one that motivated it', () => {
    for (let netRemainder = 0; netRemainder < 1000; netRemainder += 1) {
      for (const vatRemainder of [0, 1, 250, 499, 500, 501, 750, 999]) {
        const netMilliFils = fils(2500) + netRemainder
        const vatMilliFils = fils(125) + vatRemainder
        const triple = toWireMoneyTriple(
          { netMilliFils, vatMilliFils, grossMilliFils: netMilliFils + vatMilliFils }, 'AED'
        )
        expect(
          triple.net.amount + triple.vat.amount,
          `net=${netMilliFils} vat=${vatMilliFils}`
        ).toBe(triple.gross.amount)
      }
    }
  })

  it('rounds each part half-up, matching the ledger', () => {
    const triple = toWireMoneyTriple(
      { netMilliFils: 1_500, vatMilliFils: 500, grossMilliFils: 2_000 }, 'AED'
    )
    expect(triple.net.amount).toBe(2)
    expect(triple.vat.amount).toBe(1)
    expect(triple.gross.amount).toBe(3)
  })

  it('carries the currency onto every leg', () => {
    const triple = toWireMoneyTriple(
      { netMilliFils: fils(10), vatMilliFils: 0, grossMilliFils: fils(10) }, 'AED'
    )
    for (const leg of [triple.net, triple.vat, triple.gross]) expect(leg.currency).toBe('AED')
  })

  it('REFUSES a triple whose milli-fils parts do not already tie', () => {
    // Deriving gross would silently paper over an upstream defect: if the source disagrees, the
    // wire figure would look consistent while the stored evidence does not.
    expect(() => toWireMoneyTriple(
      { netMilliFils: fils(100), vatMilliFils: fils(5), grossMilliFils: fils(999) }, 'AED'
    )).toThrow(/do not tie/i)
  })
})

describe('toMinorUnitMoney on signed amounts', () => {
  it('rounds a negative variance symmetrically, away from zero at the half', () => {
    // Variances are signed. An asymmetric rounding would bias every credit against the bank.
    expect(toMinorUnitMoney(-1_500, 'AED')).toEqual({ amount: -2, currency: 'AED' })
    expect(toMinorUnitMoney(1_500, 'AED')).toEqual({ amount: 2, currency: 'AED' })
  })
})
