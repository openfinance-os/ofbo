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
