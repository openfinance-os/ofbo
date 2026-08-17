import { describe, expect, it } from 'vitest'
import {
  SCHEME_RATE_CARD_2026_06_02,
  aed,
  fils,
  rateUsage,
  receivableMeteredLines,
  resolveLfiOverageRate,
  type DirectoryOverageSnapshot,
  type MeteredLine
} from '../src/index.js'

/**
 * BILL-12 — per-LFI, effective-dated data-overage rates (ADR 0007 D3).
 *
 * Above the scheme free thresholds each LFI publishes its OWN overage rate in the Trust
 * Framework directory (`ApiMetadata.OverLimitFees`); an absent or empty value means that LFI
 * charges nothing. Pricing the bank's payable against its own receivable card (mirror pricing)
 * is therefore wrong for retail data overage — it is right only for scheme-uniform fees.
 *
 * The published UNIT (per call vs per page) is not confirmed against a live snapshot, so it is
 * a required field on every snapshot and is never defaulted or inferred.
 */

const SNAPSHOT: DirectoryOverageSnapshot = {
  snapshotId: 'dir-2026-06-01',
  retrievedAt: '2026-06-01T00:00:00.000Z',
  sourceUrl: 'https://data.directory.openfinance.ae/participants',
  digest: 'sha256:directory-snapshot-fixture',
  unit: 'per_page',
  rates: [
    { lfiId: 'lfi-alpha', rateMilliFils: fils(500), effectiveFrom: '2026-01-01' },
    { lfiId: 'lfi-alpha', rateMilliFils: fils(800), effectiveFrom: '2026-06-01' },
    { lfiId: 'lfi-beta', rateMilliFils: fils(221), effectiveFrom: '2026-01-01', effectiveTo: '2026-05-31' },
    { lfiId: 'lfi-gamma', rateMilliFils: 0, effectiveFrom: '2026-01-01' }
  ]
}

function overageLine(overrides: Partial<MeteredLine> = {}): MeteredLine {
  return {
    eventId: 'evt-overage',
    occurredAt: '2026-06-15T10:00:00Z',
    tppId: 'bank-as-tpp',
    clientId: 'client-a',
    counterpartyLfiId: 'lfi-alpha',
    direction: 'outbound',
    side: 'payable_lfi',
    feeClass: 'data.retail_page',
    units: 3,
    freeUnits: 15,
    ...overrides
  }
}

describe('per-LFI directory overage resolution', () => {
  it('resolves the rate in force on the billing date, latest effective window winning', () => {
    expect(resolveLfiOverageRate(SNAPSHOT, 'lfi-alpha', '2026-05-31')).toMatchObject({
      lfiId: 'lfi-alpha',
      charges: true,
      rateMilliFils: fils(500),
      unit: 'per_page',
      effectiveFrom: '2026-01-01'
    })
    expect(resolveLfiOverageRate(SNAPSHOT, 'lfi-alpha', '2026-06-01')).toMatchObject({
      rateMilliFils: fils(800),
      effectiveFrom: '2026-06-01'
    })
  })

  it('carries the snapshot provenance on every resolution so a rated line stays traceable', () => {
    expect(resolveLfiOverageRate(SNAPSHOT, 'lfi-alpha', '2026-06-15')).toMatchObject({
      snapshotId: 'dir-2026-06-01',
      snapshotDigest: 'sha256:directory-snapshot-fixture',
      unit: 'per_page'
    })
  })

  it('treats an unpublished, expired or zero rate as "this LFI charges nothing"', () => {
    // Absent from the directory entirely.
    expect(resolveLfiOverageRate(SNAPSHOT, 'lfi-omega', '2026-06-15')).toMatchObject({
      lfiId: 'lfi-omega',
      charges: false,
      rateMilliFils: 0
    })
    // Published, but the window closed before the billing date.
    expect(resolveLfiOverageRate(SNAPSHOT, 'lfi-beta', '2026-06-15')).toMatchObject({ charges: false, rateMilliFils: 0 })
    // Published as zero — an explicit "no charge above the threshold".
    expect(resolveLfiOverageRate(SNAPSHOT, 'lfi-gamma', '2026-06-15')).toMatchObject({ charges: false, rateMilliFils: 0 })
  })

  it('rejects a snapshot that omits the unit or carries an unusable rate', () => {
    expect(() => resolveLfiOverageRate({ ...SNAPSHOT, unit: undefined as never }, 'lfi-alpha', '2026-06-15'))
      .toThrow(/unit/i)
    expect(() => resolveLfiOverageRate(
      { ...SNAPSHOT, rates: [{ lfiId: 'lfi-alpha', rateMilliFils: -1, effectiveFrom: '2026-01-01' }] },
      'lfi-alpha',
      '2026-06-15'
    )).toThrow(/non-negative/i)
    expect(() => resolveLfiOverageRate(SNAPSHOT, 'lfi-alpha', '2026-6-15')).toThrow(/YYYY-MM-DD/)
  })
})

describe('rating payable data overage against the serving LFI', () => {
  it('prices retail overage at the serving LFI rate, not the bank own receivable rate', () => {
    const result = rateUsage([overageLine()], SCHEME_RATE_CARD_2026_06_02, '2026-06', [], {
      overageSnapshot: SNAPSHOT
    })

    // 3 billable pages x AED 8.00 (lfi-alpha, June window) — NOT the card's fils(950) mirror rate.
    expect(result.priced[0]?.amountMilliFils).toBe(fils(2_400))
    expect(result.priced[0]?.rateDetail).toMatchObject({
      overageSource: 'directory_snapshot',
      lfiId: 'lfi-alpha',
      unit: 'per_page',
      snapshotId: 'dir-2026-06-01'
    })
    expect(result.payableLfiTotalMilliFils).toBe(fils(2_400))
  })

  it('charges once per call when the directory publishes a per-call rate', () => {
    const result = rateUsage([overageLine({ units: 3 })], SCHEME_RATE_CARD_2026_06_02, '2026-06', [], {
      overageSnapshot: { ...SNAPSHOT, unit: 'per_call' }
    })

    // Per-call pricing bills the single chargeable call once, regardless of the 3 overage pages.
    expect(result.priced[0]?.amountMilliFils).toBe(fils(800))
    expect(result.priced[0]?.rateDetail).toMatchObject({ unit: 'per_call', chargedUnits: 1 })
  })

  it('costs nothing when the serving LFI publishes no rate', () => {
    const result = rateUsage([overageLine({ counterpartyLfiId: 'lfi-omega' })], SCHEME_RATE_CARD_2026_06_02, '2026-06', [], {
      overageSnapshot: SNAPSHOT
    })

    expect(result.priced[0]?.amountMilliFils).toBe(0)
    expect(result.priced[0]?.rateDetail).toMatchObject({ overageSource: 'directory_snapshot', charges: false })
  })

  it('never charges for pages inside the free threshold', () => {
    const result = rateUsage([overageLine({ units: 0, freeUnits: 15 })], SCHEME_RATE_CARD_2026_06_02, '2026-06', [], {
      overageSnapshot: SNAPSHOT
    })

    expect(result.priced[0]?.amountMilliFils).toBe(0)
  })

  it('fails closed when a chargeable overage line has no directory evidence to price it', () => {
    expect(() => rateUsage([overageLine()], SCHEME_RATE_CARD_2026_06_02, '2026-06'))
      .toThrow(/directory overage snapshot/i)

    expect(() => rateUsage([overageLine({ counterpartyLfiId: undefined })], SCHEME_RATE_CARD_2026_06_02, '2026-06', [], {
      overageSnapshot: SNAPSHOT
    })).toThrow(/serving LFI/i)
  })

  it('never lets an unpriceable payable line break a receivable projection', () => {
    // The fail-closed throw must protect the payable statement without taking the regulated
    // receivable reports (expected memo, revenue assurance, closed-period re-rating) down with it:
    // those read only receivable lines and hold no directory evidence.
    const mixed: MeteredLine[] = [
      overageLine(),
      {
        eventId: 'evt-receivable',
        occurredAt: '2026-06-15T10:00:00Z',
        tppId: 'tpp-a',
        side: 'receivable',
        feeClass: 'payment.p2p_sme',
        units: 1
      }
    ]

    expect(() => rateUsage(mixed, SCHEME_RATE_CARD_2026_06_02, '2026-06')).toThrow(/directory overage snapshot/i)

    const receivableOnly = rateUsage(receivableMeteredLines(mixed), SCHEME_RATE_CARD_2026_06_02, '2026-06')
    expect(receivableOnly.receivableTotalMilliFils).toBe(fils(25))
    expect(receivableOnly.priced).toHaveLength(1)
  })

  it('keeps scheme-uniform corporate data on the scheme rate, which is not LFI-published', () => {
    const corporate = overageLine({ feeClass: 'data.corporate_page', units: 4, freeUnits: undefined })
    const result = rateUsage([corporate], SCHEME_RATE_CARD_2026_06_02, '2026-06', [], { overageSnapshot: SNAPSHOT })

    // 4 pages x 40 fils — the C&P corporate page rate, no directory lookup involved.
    expect(result.priced[0]?.amountMilliFils).toBe(fils(160))
    expect(result.priced[0]?.amountMilliFils).toBe(aed(1.6))
  })
})
