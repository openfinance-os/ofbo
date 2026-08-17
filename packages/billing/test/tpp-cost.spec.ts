import { describe, expect, it } from 'vitest'
import {
  SCHEME_RATE_CARD_2026_06_02,
  buildExpectedTppCostStatement,
  divideHalfUp,
  fils,
  rateUsage,
  type DirectoryOverageSnapshot,
  type ExpectedTppCostEvidence,
  type MeteredLine
} from '../src/index.js'

/**
 * BILL-12 — the expected TPP cost statement (ADR 0007).
 *
 * What the institution should EXPECT to pay as TPP-of-record, projected from its own immutable
 * outbound metering under effective-dated rates, before any provider document exists.
 *
 * Two VAT treatments coexist and must not be conflated (ADR 0007 D4, IG v5.0 §10.9/§10.10):
 *   - Nebras API Hub fees are billed VAT-EXCLUSIVE — the scheme rate is the net amount and 5% is added.
 *   - TPP→LFI fees are scheme-defined VAT-INCLUSIVE — the scheme rate is the gross and VAT is 5/105 of it.
 * The accrual is always NET of VAT; input VAT is only recognised against a valid tax invoice (BILL-16).
 */

const SNAPSHOT: DirectoryOverageSnapshot = {
  snapshotId: 'dir-2026-06-01',
  retrievedAt: '2026-06-01T00:00:00.000Z',
  sourceUrl: 'https://data.directory.openfinance.ae/participants',
  digest: 'sha256:directory-snapshot-fixture',
  unit: 'per_page',
  rates: [{ lfiId: 'lfi-alpha', rateMilliFils: fils(800), effectiveFrom: '2026-01-01' }]
}

const EVIDENCE: ExpectedTppCostEvidence = {
  tenantId: 'bank-alpha',
  meterRunId: '4f1d9a1e-0000-4000-8000-000000000001',
  generatedAt: '2026-07-03T02:00:00.000Z',
  ratingRunAt: '2026-07-03T01:59:00.000Z',
  pricingEffectiveFrom: '2026-06-02',
  rateSnapshotHash: 'sha256:pricing-2026.06.02+dir-2026-06-01',
  directorySnapshotId: 'dir-2026-06-01'
}

/** One successful outbound payment: a Hub fee AND an executing-LFI fee from the same request. */
function meteredLines(): MeteredLine[] {
  const base = {
    occurredAt: '2026-06-15T10:00:00Z',
    tppId: 'bank-as-tpp',
    clientId: 'client-a',
    counterpartyLfiId: 'lfi-alpha',
    direction: 'outbound' as const,
    psuId: 'psu-must-not-leak'
  }
  return [
    { ...base, eventId: 'evt-pay-hub', traceId: 'fapi-pay', endpoint: 'POST /payments', side: 'payable_hub', feeClass: 'hub.standard', units: 1 },
    { ...base, eventId: 'evt-pay-lfi', traceId: 'fapi-pay', endpoint: 'POST /payments', side: 'payable_lfi', feeClass: 'payment.p2p_sme', units: 1 },
    { ...base, eventId: 'evt-data-hub', traceId: 'fapi-data', endpoint: 'GET /accounts/{id}/transactions', side: 'payable_hub', feeClass: 'hub.standard', units: 1 },
    { ...base, eventId: 'evt-data-lfi', traceId: 'fapi-data', endpoint: 'GET /accounts/{id}/transactions', side: 'payable_lfi', feeClass: 'data.retail_page', units: 3, freeUnits: 15 }
  ]
}

function statement() {
  const rating = rateUsage(meteredLines(), SCHEME_RATE_CARD_2026_06_02, '2026-06', [], { overageSnapshot: SNAPSHOT })
  return buildExpectedTppCostStatement(rating, EVIDENCE)
}

describe('expected TPP cost statement', () => {
  it('splits the expected cost into Hub, LFI-payment and LFI-data streams', () => {
    const result = statement()

    // Hub: 2 calls x 2.5 fils, billed VAT-exclusive, so the scheme rate IS the net accrual.
    expect(result.totals.nebrasHubNetMilliFils).toBe(fils(5))
    // LFI payment: one P2P transfer at 25 fils gross, VAT-inclusive.
    expect(result.totals.underlyingLfiPaymentNetMilliFils).toBe(fils(25) - divideHalfUp(fils(25) * 5, 105))
    // LFI data: 3 overage pages at the serving LFI's published AED 8.00, VAT-inclusive.
    expect(result.totals.underlyingLfiDataNetMilliFils).toBe(fils(2_400) - divideHalfUp(fils(2_400) * 5, 105))
    expect(result.totals.totalNetMilliFils).toBe(
      result.totals.nebrasHubNetMilliFils
      + result.totals.underlyingLfiPaymentNetMilliFils
      + result.totals.underlyingLfiDataNetMilliFils
    )
  })

  it('applies the exclusive Hub and inclusive LFI VAT treatments per line', () => {
    const result = statement()
    const hub = result.lines.find((line) => line.costRecipientType === 'nebras' && line.apiFamily === 'payments')
    const lfi = result.lines.find((line) => line.feeClass === 'payment.p2p_sme')

    // One Hub call on the payment request: 2.5 fils, and the scheme rate IS the net accrual.
    expect(hub).toMatchObject({ vatTreatment: 'exclusive', expectedNetMilliFils: fils(2.5) })
    expect(hub?.vatMilliFils).toBe(divideHalfUp(fils(2.5) * 5, 100))
    expect(hub?.expectedGrossMilliFils).toBe(hub!.expectedNetMilliFils + hub!.vatMilliFils)

    expect(lfi).toMatchObject({ vatTreatment: 'inclusive', expectedGrossMilliFils: fils(25) })
    expect(lfi?.vatMilliFils).toBe(divideHalfUp(fils(25) * 5, 105))
    expect(lfi?.expectedNetMilliFils).toBe(lfi!.expectedGrossMilliFils - lfi!.vatMilliFils)
  })

  it('holds net + VAT = gross on every line and across the statement', () => {
    const result = statement()

    for (const line of result.lines) {
      expect(line.expectedNetMilliFils + line.vatMilliFils).toBe(line.expectedGrossMilliFils)
    }
    expect(result.totals.totalNetMilliFils + result.totals.totalVatMilliFils).toBe(result.totals.totalGrossMilliFils)
    expect(result.totals.totalNetMilliFils).toBe(result.lines.reduce((sum, line) => sum + line.expectedNetMilliFils, 0))
  })

  it('attributes every line to its cost recipient and keeps the two recipients distinct', () => {
    const result = statement()

    const recipients = new Set(result.lines.map((line) => `${line.costRecipientType}:${line.costRecipientId}`))
    expect(recipients).toEqual(new Set(['nebras:NEBRAS', 'underlying_lfi:lfi-alpha']))
    expect(result.lines.every((line) => line.costRecipientType === 'nebras' || line.costRecipientId === 'lfi-alpha')).toBe(true)
  })

  it('carries the evidence chain needed to reproduce and defend every amount', () => {
    const result = statement()

    expect(result).toMatchObject({
      period: '2026-06',
      tenantId: 'bank-alpha',
      rateCardVersion: SCHEME_RATE_CARD_2026_06_02.version,
      evidence: {
        meterRunId: EVIDENCE.meterRunId,
        rateSnapshotHash: EVIDENCE.rateSnapshotHash,
        pricingEffectiveFrom: '2026-06-02',
        directorySnapshotId: 'dir-2026-06-01',
        ratingRunAt: EVIDENCE.ratingRunAt
      }
    })
    const dataLine = result.lines.find((line) => line.feeClass === 'data.retail_page')
    expect(dataLine?.eventIds).toEqual(['evt-data-lfi'])
    expect(dataLine?.fapiInteractionIds).toEqual(['fapi-data'])
    expect(result.lines.every((line) => line.eventIds.length > 0)).toBe(true)
  })

  it('never copies a PSU identifier into the cost statement', () => {
    const serialised = JSON.stringify(statement())

    expect(serialised).not.toContain('psu-must-not-leak')
    expect(serialised).not.toContain('psuId')
  })

  it('is deterministic and does not mutate the rating it projects', () => {
    const rating = rateUsage(meteredLines(), SCHEME_RATE_CARD_2026_06_02, '2026-06', [], { overageSnapshot: SNAPSHOT })
    const before = structuredClone(rating)

    const first = buildExpectedTppCostStatement(rating, EVIDENCE)
    const second = buildExpectedTppCostStatement(rating, EVIDENCE)

    expect(first).toEqual(second)
    expect(rating).toEqual(before)
  })

  it('aggregates repeated traffic into one line per cost dimension while keeping all evidence', () => {
    const lines = [...meteredLines(), {
      eventId: 'evt-pay-hub-2',
      traceId: 'fapi-pay-2',
      occurredAt: '2026-06-16T10:00:00Z',
      tppId: 'bank-as-tpp',
      clientId: 'client-a',
      counterpartyLfiId: 'lfi-alpha',
      direction: 'outbound' as const,
      endpoint: 'POST /payments',
      side: 'payable_hub' as const,
      feeClass: 'hub.standard' as const,
      units: 1
    }]
    const rating = rateUsage(lines, SCHEME_RATE_CARD_2026_06_02, '2026-06', [], { overageSnapshot: SNAPSHOT })

    const result = buildExpectedTppCostStatement(rating, EVIDENCE)
    const hubPayments = result.lines.find((line) => line.costRecipientType === 'nebras' && line.apiFamily === 'payments')

    expect(hubPayments).toMatchObject({ units: 2, events: 2 })
    expect(hubPayments?.eventIds).toEqual(['evt-pay-hub', 'evt-pay-hub-2'])
    expect(result.totals.nebrasHubNetMilliFils).toBe(fils(7.5))
  })

  it('classifies each line by product and API family for cost attribution', () => {
    const result = statement()

    expect(result.lines.find((line) => line.feeClass === 'payment.p2p_sme')).toMatchObject({
      productFamily: 'payments',
      apiFamily: 'payments',
      feeStream: 'lfi_payment'
    })
    expect(result.lines.find((line) => line.feeClass === 'data.retail_page')).toMatchObject({
      productFamily: 'data',
      apiFamily: 'accounts',
      feeStream: 'lfi_data',
      customerSegment: 'retail'
    })
    expect(result.lines.filter((line) => line.feeStream === 'hub')).toHaveLength(2)
  })

  it('rejects evidence that would leave an amount unreproducible', () => {
    const rating = rateUsage(meteredLines(), SCHEME_RATE_CARD_2026_06_02, '2026-06', [], { overageSnapshot: SNAPSHOT })

    expect(() => buildExpectedTppCostStatement(rating, { ...EVIDENCE, meterRunId: '' })).toThrow(/meterRunId/)
    expect(() => buildExpectedTppCostStatement(rating, { ...EVIDENCE, rateSnapshotHash: '' })).toThrow(/rateSnapshotHash/)
    expect(() => buildExpectedTppCostStatement(rating, { ...EVIDENCE, generatedAt: '2026-07-03' })).toThrow(/generatedAt/)
  })

  it('produces an empty, well-formed statement when the institution consumed nothing', () => {
    const rating = rateUsage([], SCHEME_RATE_CARD_2026_06_02, '2026-06')

    const result = buildExpectedTppCostStatement(rating, EVIDENCE)

    expect(result.lines).toEqual([])
    expect(result.totals).toMatchObject({ totalNetMilliFils: 0, totalVatMilliFils: 0, totalGrossMilliFils: 0 })
  })
})
