/**
 * Reading a SQL `date` back as the calendar date it actually is.
 *
 * A SQL `date` has no time and no zone — `2025-10-01` is a calendar day, not an instant. But
 * node-postgres parses it into a JS `Date` at LOCAL midnight, and the obvious way to get a string
 * back out, `value.toISOString().slice(0, 10)`, converts that local instant to UTC first.
 *
 *   Dubai (UTC+4):    local midnight → 2025-09-30T20:00Z → toISOString → 2025-09-30   WRONG
 *   UTC:              local midnight → 2025-10-01T00:00Z → toISOString → 2025-10-01   right
 *   New York (UTC-5): local midnight → 2025-10-01T05:00Z → toISOString → 2025-10-01   right
 *
 * The error is therefore EAST of UTC only — which is precisely where this product runs, and
 * precisely nowhere that anyone tests. Every CI runner and every container defaults to UTC, so the
 * broken form was correct in every environment that ever ran it. It was live in two readers:
 *
 *   - `tenant_configuration.year_anchor_date`, which drives `yearStep()` and therefore which tier
 *     of the scheme's stepped fee schedule (38 → 35 → 32 → 29 → 25 bps) applies. A day's error
 *     across a scheme-year boundary bills a whole month at the wrong rate.
 *   - `billing_collection_invoice.issued_at / due_at / settled_at`, where a due date read a day
 *     early makes an invoice overdue a day early and moves the dunning state machine with it.
 *
 * The fix is to read the date back the same way it was written: from its LOCAL components, which
 * are exactly what node-postgres populated. No zone conversion happens in either direction.
 *
 * A string passes straight through — some drivers and some queries (`to_char`, `::text`) already
 * return `YYYY-MM-DD`, and that needs no interpretation at all.
 */
export function isoDateFromPg(value: unknown): string {
  if (value instanceof Date) {
    // Local components, NOT toISOString(): node-postgres built this Date at local midnight, so
    // its local calendar fields are the date the database holds.
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  return String(value).slice(0, 10)
}
