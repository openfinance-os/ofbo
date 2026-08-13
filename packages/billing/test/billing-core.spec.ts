import { describe, expect, it } from 'vitest'
import {
  MF_PER_AED,
  SCHEME_RATE_CARD_2026_06_02,
  aed,
  bpsOfFils,
  detectUpstreamChange,
  diffRateCards,
  divideHalfUp,
  fils,
  prepareRateCardChangeReview,
  rateCardAt,
  rateCardForTenant,
  rateUsage,
  toMinorUnitMoney,
  yearStep,
  type MeteredLine,
  type RateCard
} from '../src/index.js'

describe('billing money', () => {
  it('keeps all stored arithmetic in integer milli-fils', () => {
    expect(aed(1)).toBe(100_000)
    expect(fils(2.5)).toBe(2_500)
    expect(divideHalfUp(5, 2)).toBe(3)
    expect(divideHalfUp(-5, 2)).toBe(-3)
    expect(bpsOfFils(10_000, 38)).toBe(38_000)
  })

  it('rounds only at the API/P9 minor-unit boundary', () => {
    expect(toMinorUnitMoney(1_499, 'AED')).toEqual({ amount: 1, currency: 'AED' })
    expect(toMinorUnitMoney(1_500, 'AED')).toEqual({ amount: 2, currency: 'AED' })
    expect(toMinorUnitMoney(-1_500, 'AED')).toEqual({ amount: -2, currency: 'AED' })
  })
})

describe('effective-dated scheme rate card', () => {
  it('selects the card in force and calculates year steps by calendar anniversary', () => {
    expect(rateCardAt([SCHEME_RATE_CARD_2026_06_02], '2026-06-02').version).toBe('2026.06.02')
    expect(() => rateCardAt([SCHEME_RATE_CARD_2026_06_02], '2026-06-01')).toThrow(/no rate card/i)
    expect(yearStep(SCHEME_RATE_CARD_2026_06_02, '2026-09-30')).toBe(1)
    expect(yearStep(SCHEME_RATE_CARD_2026_06_02, '2026-10-01')).toBe(2)
    expect(Object.isFrozen(SCHEME_RATE_CARD_2026_06_02.receivable['payment.merchant_collection'])).toBe(true)
  })

  it('produces a reviewable field-level diff without changing either version', () => {
    const next = structuredClone(SCHEME_RATE_CARD_2026_06_02) as RateCard
    next.version = '2026.08.12'
    next.effectiveFrom = '2026-08-12'
    next.receivable['data.retail_page'].overageMilliFils = fils(1_000)

    const changes = diffRateCards(SCHEME_RATE_CARD_2026_06_02, next)
    expect(changes).toContainEqual({
      path: 'receivable.data.retail_page.overageMilliFils',
      before: fils(950),
      after: fils(1_000)
    })
    expect(SCHEME_RATE_CARD_2026_06_02.receivable['data.retail_page'].overageMilliFils).toBe(fils(950))

    expect(prepareRateCardChangeReview(SCHEME_RATE_CARD_2026_06_02, next)).toMatchObject({
      classification: 'High',
      requiresApproval: true,
      autoApply: false,
      notify: ['Finance', 'Compliance'],
      effectiveFrom: '2026-08-12'
    })
  })

  it('applies the year anchor and directory overage per tenant without mutating the scheme card', () => {
    const tenantCard = rateCardForTenant(SCHEME_RATE_CARD_2026_06_02, {
      tenantId: 'alpha-bank',
      yearAnchorDate: '2026-01-01',
      retailOverageMilliFils: fils(800)
    })

    expect(tenantCard).toMatchObject({ tenantId: 'alpha-bank', yearAnchor: { date: '2026-01-01' } })
    expect(tenantCard.receivable['data.retail_page'].overageMilliFils).toBe(fils(800))
    expect(SCHEME_RATE_CARD_2026_06_02.yearAnchor.date).toBe('2025-10-01')
  })

  it('raises a review decision when an injected upstream snapshot changes', () => {
    const decision = detectUpstreamChange(
      { sourceUrl: SCHEME_RATE_CARD_2026_06_02.source, contentHash: 'sha256:before', capturedAt: '2026-08-11T00:00:00Z' },
      { sourceUrl: SCHEME_RATE_CARD_2026_06_02.source, contentHash: 'sha256:after', capturedAt: '2026-08-12T00:00:00Z' }
    )

    expect(decision).toMatchObject({
      changed: true,
      requiresReview: true,
      autoApply: false,
      reviewTask: { type: 'RATE_CARD_UPSTREAM_REVIEW', classification: 'High', status: 'OPEN', notify: ['Finance', 'Compliance'] }
    })
  })
})

describe('pure rating', () => {
  it('rates bps per transaction, applies the AED 50 cap, and preserves metered facts', () => {
    const lines: MeteredLine[] = [
      {
        eventId: 'evt-small',
        occurredAt: '2026-06-15T10:00:00Z',
        tppId: 'tpp-a',
        side: 'receivable',
        feeClass: 'payment.merchant_collection',
        units: 1,
        valueMilliFils: aed(200),
        chargeableValueMilliFils: aed(200)
      },
      {
        eventId: 'evt-capped',
        occurredAt: '2026-06-15T10:01:00Z',
        tppId: 'tpp-a',
        side: 'receivable',
        feeClass: 'payment.merchant_collection',
        units: 1,
        valueMilliFils: aed(20_000),
        chargeableValueMilliFils: aed(20_000)
      }
    ]
    const before = structuredClone(lines)

    const result = rateUsage(lines, SCHEME_RATE_CARD_2026_06_02, '2026-06')

    expect(result.priced.map((line) => line.amountMilliFils)).toEqual([aed(0.76), aed(50)])
    expect(result.statements[0]?.receivableTotalMilliFils).toBe(aed(50.76))
    expect(result.priced[1]?.rateDetail).toMatchObject({ basisPoints: 38, capped: true })
    expect(lines).toEqual(before)
  })

  it('applies the SME bulk cap across individual evidence lines', () => {
    const lines: MeteredLine[] = Array.from({ length: 11 }, (_, index) => ({
      eventId: `evt-bulk-${index}`,
      occurredAt: '2026-06-15T10:00:00Z',
      tppId: 'tpp-a',
      side: 'receivable' as const,
      feeClass: 'payment.sme_bulk',
      units: 1,
      batchId: 'batch-1'
    }))

    const result = rateUsage(lines, SCHEME_RATE_CARD_2026_06_02, '2026-06')

    expect(result.priced.reduce((sum, line) => sum + line.amountMilliFils, 0)).toBe(fils(250))
    expect(result.batchAdjustments).toEqual([
      { batchId: 'batch-1', grossMilliFils: fils(275), cappedMilliFils: fils(250), savedMilliFils: fils(25), transactionCount: 11 }
    ])
  })

  it('rates hub costs per client and keeps inbound hub-borne calls explicit at zero', () => {
    const lines: MeteredLine[] = [
      {
        eventId: 'evt-hub',
        occurredAt: '2026-06-15T10:00:00Z',
        tppId: 'bank-as-tpp',
        clientId: 'client-a',
        side: 'payable_hub',
        feeClass: 'hub.standard',
        units: 4
      },
      {
        eventId: 'evt-free',
        occurredAt: '2026-06-15T10:01:00Z',
        tppId: 'tpp-a',
        side: 'free_to_lfi',
        feeClass: 'no_lfi_charge',
        units: 1
      }
    ]

    const result = rateUsage(lines, SCHEME_RATE_CARD_2026_06_02, '2026-06', [{ id: 'client-a', name: 'Client A', markupPercent: 15 }])

    expect(result.tppAsService[0]).toMatchObject({
      clientId: 'client-a',
      hubMilliFils: fils(10),
      costMilliFils: fils(10),
      rebillMilliFils: fils(11.5),
      marginMilliFils: fils(1.5)
    })
    expect(result.freeToLfiEvents).toBe(1)
    expect(result.receivableTotalMilliFils).toBe(0)
    expect(result.receivableTotalMilliFils % MF_PER_AED).toBe(0)
  })

  it('fails closed when a fee class is supplied on the wrong billing side', () => {
    const line: MeteredLine = {
      eventId: 'evt-invalid-side',
      occurredAt: '2026-06-15T10:00:00Z',
      tppId: 'tpp-a',
      side: 'payable_hub',
      feeClass: 'payment.p2p_sme',
      units: 1
    }

    expect(() => rateUsage([line], SCHEME_RATE_CARD_2026_06_02, '2026-06')).toThrow(/no rate-card entry/i)
  })
})
