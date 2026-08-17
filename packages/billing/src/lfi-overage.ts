/**
 * BILL-12 — per-LFI, effective-dated data-sharing overage rates (ADR 0007 decision 3).
 *
 * Above the scheme's free retail thresholds (15 attended / 5 unattended pages per customer per day)
 * the Commercial & Pricing Model does NOT set a rate: **each serving LFI publishes its own** in the
 * Trust Framework directory, at `participants[].AuthorisationServers[].ApiResources[].ApiMetadata
 * .OverLimitFees`, and an absent or empty value means that LFI charges nothing above the threshold.
 *
 * So the institution's payable for retail data overage cannot be derived from its own receivable
 * rate card — that mirror is only valid for scheme-uniform fees (payment fees, corporate pages).
 *
 * ## The unit is explicit, never assumed
 *
 * The directory publishes `OverLimitFees` as a money value per **call**, while this codebase's
 * retail page model counts **pages** (100 transaction lines). Which one a given snapshot carries
 * is UNCONFIRMED — the live directory is not reachable from the build environment, so no snapshot
 * has been observed (ADR 0007 open verification items; BILL-12 pre-task). Rather than guess, every
 * snapshot must state its `unit`, and rating applies it accordingly. Guessing would silently
 * mis-state the payable by the page count of every overage call.
 */

export type OverageRateUnit = 'per_call' | 'per_page'

export interface LfiOverageRate {
  /** Trust Framework organisation id of the LFI serving the data. */
  lfiId: string
  /** Published overage rate in integer milli-fils, in the snapshot's `unit`. */
  rateMilliFils: number
  effectiveFrom: string
  /** Inclusive last day the rate applies; omitted means open-ended. */
  effectiveTo?: string
}

export interface DirectoryOverageSnapshot {
  snapshotId: string
  retrievedAt: string
  sourceUrl: string
  /**
   * REQUIRED for the same reason `unit` is: these rates come from an external directory this
   * codebase has never observed, and an assumed denomination would be summed straight into the
   * payable total. Integer minor units + ISO 4217 is the binding money convention (CLAUDE.md).
   */
  currency: 'AED'
  /** Canonical digest of the raw directory payload this snapshot was derived from. */
  digest: string
  /** REQUIRED: the unit the source publishes rates in. Never defaulted — see the module note. */
  unit: OverageRateUnit
  rates: readonly LfiOverageRate[]
}

export interface ResolvedLfiOverageRate {
  lfiId: string
  currency: 'AED'
  /** false when this LFI publishes no applicable rate: the scheme reading is "charges nothing". */
  charges: boolean
  rateMilliFils: number
  unit: OverageRateUnit
  /** Effective date of the window applied, or null when nothing applied. */
  effectiveFrom: string | null
  snapshotId: string
  snapshotDigest: string
}

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const UNITS: readonly OverageRateUnit[] = ['per_call', 'per_page']

function assertDate(value: string, label: string): string {
  if (typeof value !== 'string' || !DATE.test(value)) throw new RangeError(`${label} must be YYYY-MM-DD`)
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError(`${label} is not a valid calendar date`)
  }
  return value
}

function assertSnapshot(snapshot: DirectoryOverageSnapshot): void {
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError('directory overage snapshot is required')
  if (!UNITS.includes(snapshot.unit)) {
    throw new RangeError(`directory overage snapshot must declare an explicit unit (${UNITS.join(' | ')}); it is never assumed`)
  }
  if (!snapshot.snapshotId?.trim()) throw new RangeError('directory overage snapshot requires a snapshotId')
  if (!snapshot.digest?.trim()) throw new RangeError('directory overage snapshot requires a digest')
  if (snapshot.currency !== 'AED') {
    throw new RangeError('directory overage snapshot must declare currency AED; it is never assumed')
  }
  if (!Array.isArray(snapshot.rates)) throw new TypeError('directory overage snapshot requires a rates array')

  for (const [index, rate] of snapshot.rates.entries()) {
    if (!rate.lfiId?.trim()) throw new RangeError(`rates[${index}].lfiId cannot be empty`)
    if (!Number.isSafeInteger(rate.rateMilliFils) || rate.rateMilliFils < 0) {
      throw new RangeError(`rates[${index}].rateMilliFils must be a non-negative safe integer`)
    }
    assertDate(rate.effectiveFrom, `rates[${index}].effectiveFrom`)
    if (rate.effectiveTo !== undefined) {
      assertDate(rate.effectiveTo, `rates[${index}].effectiveTo`)
      if (rate.effectiveTo < rate.effectiveFrom) {
        throw new RangeError(`rates[${index}].effectiveTo cannot precede effectiveFrom`)
      }
    }
  }
}

/**
 * Resolve the overage rate a serving LFI charges on a given billing date.
 *
 * A missing LFI, a closed window, or an explicitly published zero all resolve to
 * `charges: false` — the three ways the scheme expresses "nothing above the threshold".
 * The snapshot's provenance travels with the result so a rated line stays defensible.
 */
export function resolveLfiOverageRate(
  snapshot: DirectoryOverageSnapshot,
  lfiId: string,
  onDate: string
): ResolvedLfiOverageRate {
  assertSnapshot(snapshot)
  if (!lfiId?.trim()) throw new RangeError('lfiId is required to resolve an overage rate')
  assertDate(onDate, 'onDate')

  const provenance = {
    lfiId,
    currency: snapshot.currency,
    unit: snapshot.unit,
    snapshotId: snapshot.snapshotId,
    snapshotDigest: snapshot.digest
  }

  const applicable = snapshot.rates
    .filter((rate) => rate.lfiId === lfiId)
    .filter((rate) => rate.effectiveFrom <= onDate && (rate.effectiveTo === undefined || onDate <= rate.effectiveTo))
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))

  const inForce = applicable[0]
  if (!inForce || inForce.rateMilliFils === 0) {
    return { ...provenance, charges: false, rateMilliFils: 0, effectiveFrom: inForce?.effectiveFrom ?? null }
  }
  return { ...provenance, charges: true, rateMilliFils: inForce.rateMilliFils, effectiveFrom: inForce.effectiveFrom }
}
