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
