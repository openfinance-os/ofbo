/**
 * Adopting-bank default (PRD §10): SLA/approval clocks pause over weekends.
 * Weekend = Sat/Sun (UAE post-2022); the bank calendar becomes configurable at
 * enterprise adoption. Minute-resolution walk — bounded inputs (hours ≤ a few).
 */
export function addBusinessHours(from: Date, hours: number): Date {
  const d = new Date(from)
  let remainingMinutes = Math.round(hours * 60)
  while (remainingMinutes > 0) {
    d.setUTCMinutes(d.getUTCMinutes() + 1)
    const day = d.getUTCDay()
    if (day !== 0 && day !== 6) remainingMinutes--
  }
  return d
}

/**
 * The next-business-day refund SLA deadline (BACKOFFICE-21): end (23:59:59.999Z)
 * of the next business day after `from`, skipping weekends (BD default calendar).
 */
export function endOfNextBusinessDay(from: Date): Date {
  const d = new Date(from)
  do {
    d.setUTCDate(d.getUTCDate() + 1)
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6)
  d.setUTCHours(23, 59, 59, 999)
  return d
}

/**
 * The end (23:59:59.999Z) of the Nth business day after `from`, skipping weekends
 * (BD default calendar). N=1 equals endOfNextBusinessDay. Drives the complaint SLA
 * matrix (BACKOFFICE-24): resolution due `n` business days after the clock starts.
 */
export function endOfNthBusinessDay(from: Date, n: number): Date {
  let d = new Date(from)
  for (let i = 0; i < Math.max(1, n); i++) d = endOfNextBusinessDay(d)
  return d
}
