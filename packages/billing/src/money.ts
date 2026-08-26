export const MF_PER_FIL = 1_000
export const FILS_PER_AED = 100
export const MF_PER_AED = MF_PER_FIL * FILS_PER_AED

export interface MinorUnitMoney {
  amount: number
  currency: 'AED'
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`)
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer`)
}

function roundedSafeInteger(value: number, label: string): number {
  assertFinite(value, label)
  const rounded = Math.round(value)
  assertSafeInteger(rounded, label)
  return rounded
}

/** Convert an AED-denominated configuration value into integer milli-fils. */
export function aed(value: number): number {
  return roundedSafeInteger(value * MF_PER_AED, 'AED value')
}

/** Convert a fils-denominated configuration value into integer milli-fils. */
export function fils(value: number): number {
  return roundedSafeInteger(value * MF_PER_FIL, 'fils value')
}

/** Symmetric half-up division for signed integer amounts. */
export function divideHalfUp(numerator: number, denominator: number): number {
  assertSafeInteger(numerator, 'numerator')
  assertSafeInteger(denominator, 'denominator')
  if (denominator <= 0) throw new RangeError('denominator must be greater than zero')

  const magnitude = Math.abs(numerator)
  const result = Math.floor((magnitude + Math.floor(denominator / 2)) / denominator)
  return numerator < 0 ? -result : result
}

/** Basis points of a value in fils, returned as integer milli-fils. */
export function bpsOfFils(valueFils: number, basisPoints: number): number {
  assertSafeInteger(valueFils, 'valueFils')
  assertSafeInteger(basisPoints, 'basisPoints')
  const product = valueFils * basisPoints
  assertSafeInteger(product, 'basis-point product')
  return divideHalfUp(product, 10)
}

/** Convert milli-fils to the API/P9 minor-unit representation. */
export function toMinorUnitMoney(milliFils: number, currency: 'AED'): MinorUnitMoney {
  assertSafeInteger(milliFils, 'milliFils')
  return { amount: divideHalfUp(milliFils, MF_PER_FIL), currency }
}

/**
 * A net / VAT / gross triple crossing from milli-fils storage to the wire.
 *
 * `gross` is DERIVED from the rounded parts rather than rounded independently, and that is the whole
 * reason this helper exists. Rounding all three separately produces a triple that does not tie: net
 * 2500.5 and VAT 125.5 both round up to 2501 + 126 = 2627, while gross 2626.0 rounds to 2626. A
 * consumer checking `net + vat === gross` — which the binding convention invites, and which the
 * document table's own CHECK enforces — would then see a contract violation on perfectly good data.
 *
 * The source parts must already tie in milli-fils. Deriving gross from a source that disagrees would
 * paper over an upstream defect, presenting a consistent wire figure over inconsistent evidence.
 */
export interface WireMoneyTriple {
  net: MinorUnitMoney
  vat: MinorUnitMoney
  gross: MinorUnitMoney
}

export function toWireMoneyTriple(
  parts: { netMilliFils: number; vatMilliFils: number; grossMilliFils: number },
  currency: 'AED'
): WireMoneyTriple {
  const { netMilliFils, vatMilliFils, grossMilliFils } = parts
  if (netMilliFils + vatMilliFils !== grossMilliFils) {
    throw new RangeError(
      `money parts do not tie in milli-fils: net ${netMilliFils} + VAT ${vatMilliFils} `
      + `is not gross ${grossMilliFils}`
    )
  }
  const net = toMinorUnitMoney(netMilliFils, currency)
  const vat = toMinorUnitMoney(vatMilliFils, currency)
  return { net, vat, gross: { amount: net.amount + vat.amount, currency } }
}
