/** Shared helpers for cursor-based list endpoints (binding convention: no offset). */

/**
 * Parse a pagination `limit` query parameter into a spreadable `{ limit }` fragment.
 *
 * Absent, empty, non-numeric, fractional, or non-positive values yield `{}` so the
 * service applies its own default — rather than coercing garbage into `NaN`, which
 * `Number('abc')` would otherwise propagate into the pagination math (`slice(0, NaN)`
 * silently returns an empty page). Callers spread the result into the list query:
 *
 *   const q = { ...cursorParam(c.req.query('cursor')), ...limitParam(c.req.query('limit')) }
 */
export function limitParam(raw: string | undefined | null): { limit?: number } {
  if (raw == null || raw === '') return {}
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? { limit: n } : {}
}
