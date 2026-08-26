import { describe, expect, it } from 'vitest'
import { SCHEME_RATE_CARD_2026_06_02, MF_PER_AED } from '@ofbo/billing'
import { DEMO_TPP_BOOK, accrueBook, accrualByTpp, meteredLinesFor } from '../src/billing-book.js'

/**
 * The demo book of business. What is worth testing here is NOT the arithmetic — `rateUsage` owns
 * that and has its own suite — but the properties that make the book usable as a demo and that a
 * careless volume edit would quietly destroy.
 */

const REF = '2026-08'

describe('demo billing book — grounded in the scheme rate card', () => {
  it('prices through the real rating engine, not a private copy of the rates', () => {
    // The retail overage is the card's, to the fils. If someone forks the maths into this module,
    // this breaks — which is the point: the demo must move when the rate card moves.
    const lean = DEMO_TPP_BOOK.find((t) => t.organisationId === 'org-lean-technologies')!
    const lines = meteredLinesFor(lean, REF, REF)
    const retail = lines.find((l) => l.feeClass === 'data.retail_page')!
    const expected = retail.units * SCHEME_RATE_CARD_2026_06_02.receivable['data.retail_page'].overageMilliFils

    const accrual = accrualByTpp(REF, REF).get('org-lean-technologies')!
    const retailLine = accrual.breakdown.find((l) => l.feeClass === 'data.retail_page')!
    expect(retailLine.amountMilliFils).toBe(expected)
  })

  it('charges only pages ABOVE the free allowance, never the whole volume', () => {
    const lean = DEMO_TPP_BOOK.find((t) => t.organisationId === 'org-lean-technologies')!
    const free = SCHEME_RATE_CARD_2026_06_02.receivable['data.retail_page'].freeTier.attended * lean.monthly.psusServed! * 30
    const retail = meteredLinesFor(lean, REF, REF).find((l) => l.feeClass === 'data.retail_page')!
    expect(retail.units).toBe(lean.monthly.retailDataPages! - free)
    expect(retail.units).toBeLessThan(lean.monthly.retailDataPages!)
  })

  /**
   * The defect this whole module exists to prevent. Production shipped a registry where the
   * recognisable UAE names showed a dash and the invented ones carried every dirham, because only
   * the later-seeded institutions were given accruals at all.
   */
  it('gives the real UAE providers real revenue', () => {
    const book = accrualByTpp(REF, REF)
    for (const id of ['org-lean-technologies', 'org-tabby', 'org-tarabut-gateway']) {
      expect(book.get(id)!.accrualMilliFils, `${id} must not be inert`).toBeGreaterThan(0)
    }
  })

  it('keeps zero-traffic states at exactly zero', () => {
    const book = accrualByTpp(REF, REF)
    // Onboarding and suspended institutions have no production traffic, so no accrual — a
    // suspended TPP still billing would be a contradiction an operator would rightly query.
    expect(book.get('org-baraka')!.accrualMilliFils).toBe(0)
    expect(book.get('org-falaj-money')!.accrualMilliFils).toBe(0)
  })

  it('shows at least one TPP sitting INSIDE its free allowance', () => {
    // A book where everyone pays hides half of how the scheme prices data sharing.
    const underTier = DEMO_TPP_BOOK.filter((profile) => {
      if (!profile.monthly.retailDataPages) return false
      return meteredLinesFor(profile, REF, REF).every((l) => l.feeClass !== 'data.retail_page')
    })
    expect(underTier.length).toBeGreaterThan(0)
  })

  it('is legible as a list — no counterparty dwarfs the rest by orders of magnitude', () => {
    const earning = accrueBook(REF, SCHEME_RATE_CARD_2026_06_02, REF)
      .map((b) => b.accrualMilliFils)
      .filter((v) => v > 0)
      .sort((a, b) => b - a)
    // A 1000:1 spread makes every row but the first read as noise on the registry screen.
    expect(earning[0]! / earning[earning.length - 1]!).toBeLessThan(100)
  })

  it('distinguishes the business models rather than sprinkling the same mix everywhere', () => {
    const book = accrualByTpp(REF, REF)
    const classesFor = (id: string) => new Set(book.get(id)!.breakdown.map((l) => l.feeClass))
    // The BNPL earns on collection value; the aggregator earns on data pages. If these ever
    // converge, the registry stops telling an operator what kind of counterparty they are.
    expect(classesFor('org-tabby')).toContain('payment.merchant_collection')
    expect(classesFor('org-tabby')).not.toContain('data.retail_page')
    expect(classesFor('org-lean-technologies')).toContain('data.retail_page')
    expect(classesFor('org-lean-technologies')).not.toContain('payment.merchant_collection')
  })

  it('is deterministic — the same period and reference always price identically', () => {
    const a = accrueBook(REF, SCHEME_RATE_CARD_2026_06_02, REF)
    const b = accrueBook(REF, SCHEME_RATE_CARD_2026_06_02, REF)
    expect(a).toEqual(b)
  })

  /**
   * Periods are relative to today, so an absolutely-anchored growth curve would compound against
   * wall-clock time and the book would inflate for ever with nobody editing it. Anchoring growth
   * to the reference month is what stops that.
   *
   * Asserted on a DATA-only counterparty, because that is the side the growth curve drives. The
   * book's overall total legitimately DOES move year over year — the card's merchant-collection
   * schedule tapers 38 → 35 bps in scheme year 2 — and that is the rate card working, not drift.
   * The second assertion pins the direction: the demo may get cheaper over time, never richer.
   */
  it('does not inflate as real time passes — the reference month is always the peak', () => {
    const dataOnly = (reference: string) =>
      accrueBook(reference, SCHEME_RATE_CARD_2026_06_02, reference)
        .find((b) => b.organisationId === 'org-lean-technologies')!.accrualMilliFils
    expect(dataOnly('2027-08')).toBe(dataOnly('2026-08'))
    expect(dataOnly('2031-08')).toBe(dataOnly('2026-08'))

    const total = (reference: string) =>
      accrueBook(reference, SCHEME_RATE_CARD_2026_06_02, reference).reduce((s, b) => s + b.accrualMilliFils, 0)
    expect(total('2027-08')).toBeLessThanOrEqual(total('2026-08'))
  })

  it('trends up into the reference month, so history reads as a business that grew', () => {
    const total = (period: string) =>
      accrueBook(period, SCHEME_RATE_CARD_2026_06_02, REF).reduce((s, b) => s + b.accrualMilliFils, 0)
    expect(total('2026-08')).toBeGreaterThan(total('2026-06'))
    expect(total('2026-06')).toBeGreaterThan(total('2026-04'))
  })

  it('produces a book of a plausible size for a mid-sized LFI', () => {
    const totalAed =
      accrueBook(REF, SCHEME_RATE_CARD_2026_06_02, REF).reduce((s, b) => s + b.accrualMilliFils, 0) / MF_PER_AED
    // Not a precise assertion — a guard against a volume edit moving the book by an order of
    // magnitude and nobody noticing until it is on a screen in front of a bank.
    expect(totalAed).toBeGreaterThan(100_000)
    expect(totalAed).toBeLessThan(2_000_000)
  })

  it('carries no PSU identifiers — only counts', () => {
    for (const profile of DEMO_TPP_BOOK) {
      for (const line of meteredLinesFor(profile, REF, REF)) {
        expect(line.psuId ?? null).toBeNull()
      }
      expect(Object.keys(profile.monthly)).not.toContain('psuIds')
    }
  })
})
