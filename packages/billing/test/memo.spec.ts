import { describe, expect, it } from 'vitest'
import {
  SCHEME_RATE_CARD_2026_06_02,
  aed,
  buildExpectedCollectionMemo,
  diffCollectionMemo,
  fils,
  rateUsage,
  rerateClosedPeriod,
  type CollectionMemo,
  type MeteredLine,
  type RateCard
} from '../src/index.js'

const metered: MeteredLine[] = [
  {
    eventId: 'evt-merchant',
    occurredAt: '2026-06-15T10:00:00.000Z',
    tppId: 'tpp-a',
    traceId: 'trace-merchant',
    side: 'receivable',
    feeClass: 'payment.merchant_collection',
    units: 1,
    valueMilliFils: aed(1_000),
    chargeableValueMilliFils: aed(1_000)
  },
  {
    eventId: 'evt-data',
    occurredAt: '2026-06-16T10:00:00.000Z',
    tppId: 'tpp-b',
    traceId: 'trace-data',
    side: 'receivable',
    feeClass: 'data.corporate_page',
    units: 3
  },
  {
    eventId: 'evt-hub-cost',
    occurredAt: '2026-06-16T11:00:00.000Z',
    tppId: 'bank-as-tpp',
    traceId: 'trace-hub',
    clientId: 'client-a',
    side: 'payable_hub',
    feeClass: 'hub.standard',
    units: 1
  }
]

describe('BILL-03 expected Collection Memo', () => {
  it('produces immutable per-TPP fee-class expectations ready by the 3rd', () => {
    const rating = rateUsage(metered, SCHEME_RATE_CARD_2026_06_02, '2026-06')
    const expected = buildExpectedCollectionMemo(rating, '2026-07-03T01:00:00.000Z')

    expect(expected).toMatchObject({
      period: '2026-06',
      rateCardVersion: '2026.06.02',
      generatedAt: '2026-07-03T01:00:00.000Z',
      dueAt: '2026-07-03T23:59:59.999Z',
      generatedOnTime: true,
      totalMilliFils: aed(5)
    })
    expect(expected.lines).toEqual([
      expect.objectContaining({
        lineRef: '2026-06|tpp-a|payment.merchant_collection',
        tppId: 'tpp-a',
        feeClass: 'payment.merchant_collection',
        events: 1,
        amountMilliFils: aed(3.8),
        eventIds: ['evt-merchant'],
        traceIds: ['trace-merchant']
      }),
      expect.objectContaining({
        lineRef: '2026-06|tpp-b|data.corporate_page',
        tppId: 'tpp-b',
        feeClass: 'data.corporate_page',
        units: 3,
        amountMilliFils: fils(120)
      })
    ])
    expect(expected.lines.some((line) => line.feeClass === 'hub.standard')).toBe(false)
  })

  it('diffs every line and routes only material variance into the open 30-day query window', () => {
    const expected = buildExpectedCollectionMemo(
      rateUsage(metered, SCHEME_RATE_CARD_2026_06_02, '2026-06'),
      '2026-07-03T01:00:00.000Z'
    )
    const memo: CollectionMemo = {
      reference: 'CM-2026-06-001',
      period: '2026-06',
      issuedAt: '2026-07-05T00:00:00.000Z',
      receivedAt: '2026-07-05T08:00:00.000Z',
      lines: [
        {
          tppId: 'tpp-a',
          feeClass: 'payment.merchant_collection',
          units: 1,
          amountMilliFils: aed(3.8) + fils(1)
        },
        {
          tppId: 'tpp-b',
          feeClass: 'data.corporate_page',
          units: 3,
          amountMilliFils: fils(120) - fils(2)
        },
        {
          tppId: 'tpp-c',
          feeClass: 'payment.p2p_sme',
          units: 1,
          amountMilliFils: fils(25)
        }
      ]
    }

    const diff = diffCollectionMemo(expected, memo, fils(1))

    expect(diff).toMatchObject({
      expectedPeriod: '2026-06',
      memoReference: 'CM-2026-06-001',
      thresholdMilliFils: fils(1),
      queryDeadline: '2026-08-04T00:00:00.000Z',
      queryWindowStatus: 'open',
      materialBreaks: 2,
      matchedLines: 1,
      netVarianceMilliFils: fils(24),
      grossVarianceMilliFils: fils(28)
    })
    expect(diff.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        lineRef: '2026-06|tpp-a|payment.merchant_collection',
        varianceMilliFils: fils(1),
        status: 'matched',
        materialVariance: false
      }),
      expect.objectContaining({
        lineRef: '2026-06|tpp-b|data.corporate_page',
        varianceMilliFils: -fils(2),
        status: 'break',
        materialVariance: true,
        presence: 'both'
      }),
      expect.objectContaining({
        lineRef: '2026-06|tpp-c|payment.p2p_sme',
        expectedMilliFils: 0,
        memoMilliFils: fils(25),
        status: 'break',
        presence: 'memo_only'
      })
    ]))
  })

  it('marks a memo received after the 30-day occurrence window as expired', () => {
    const expected = buildExpectedCollectionMemo(
      rateUsage(metered, SCHEME_RATE_CARD_2026_06_02, '2026-06'),
      '2026-07-03T01:00:00.000Z'
    )
    const diff = diffCollectionMemo(expected, {
      reference: 'CM-LATE-001',
      period: '2026-06',
      issuedAt: '2026-07-05T00:00:00.000Z',
      receivedAt: '2026-08-05T00:00:00.000Z',
      lines: expected.lines.map((line) => ({
        tppId: line.tppId,
        feeClass: line.feeClass,
        units: line.units,
        amountMilliFils: line.amountMilliFils
      }))
    })

    expect(diff).toMatchObject({
      queryDeadline: '2026-08-04T00:00:00.000Z',
      queryWindowStatus: 'expired',
      daysRemainingAtIngest: -1
    })
  })

  it('re-rates a closed period as a documented replay and proves facts did not change', () => {
    const corrected = structuredClone(SCHEME_RATE_CARD_2026_06_02) as RateCard
    corrected.version = '2026.08.12-correction'
    corrected.receivable['data.corporate_page'].flatMilliFils = fils(50)
    const before = structuredClone(metered)

    const replay = rerateClosedPeriod(
      metered,
      SCHEME_RATE_CARD_2026_06_02,
      corrected,
      '2026-06',
      'RATE-REVIEW-42',
      '2026-08-12T09:00:00.000Z'
    )

    expect(replay).toMatchObject({
      period: '2026-06',
      correctionReference: 'RATE-REVIEW-42',
      previousRateCardVersion: '2026.06.02',
      correctedRateCardVersion: '2026.08.12-correction',
      factsUnchanged: true,
      totalDeltaMilliFils: fils(30)
    })
    expect(replay.meteredFactsFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/)
    expect(replay.lineDeltas).toContainEqual(expect.objectContaining({
      lineRef: '2026-06|tpp-b|data.corporate_page',
      previousMilliFils: fils(120),
      correctedMilliFils: fils(150),
      deltaMilliFils: fils(30)
    }))
    expect(metered).toEqual(before)
  })
})
