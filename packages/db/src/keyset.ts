/**
 * CODE-01 — the one implementation of cursor-keyset pagination for `packages/db`.
 *
 * WHY THIS EXISTS, and why the API looks like this.
 *
 * Sixteen stores hand-rolled this. They were NOT copies of one thing — auditing them turned up
 * three genuine divergences, and it is the third that motivates the shape of `keysetClause`:
 *
 *   1. DIRECTION — eight stores page ascending (`>`), seven descending (`<` with
 *      `ORDER BY ... DESC`). Both are legitimate; a shared helper must carry the direction.
 *   2. TIE-BREAK COLUMN — most key on `(created_at, id)` and cast the second bind to `::uuid`.
 *      `tpp_counterparty` keys on `(created_at, organisation_id)`, which is TEXT and must NOT
 *      be cast to uuid. A helper that hardcoded `::uuid` would break that store at runtime.
 *   3. PARAMETER INDEXING — fifteen stores push the two bind values FIRST and then reference
 *      `$${params.length - 1}` / `$${params.length}`. `consent-events.ts` builds the clause
 *      BEFORE pushing and references `$${params.length + 1}` / `$${params.length + 2}`.
 *      Both are correct in place and neither survives being pasted into the other.
 *
 * That third one is the whole point. A "dedup" that picked one convention and applied it
 * everywhere would produce SQL that still parses, still runs, and silently binds the wrong
 * parameters — the worst kind of bug in a regulated read path. So the helper does not expose a
 * convention at all: it takes the params array, appends the binds itself, and computes the
 * placeholders from what it just pushed. Callers cannot get the indexing wrong because callers
 * no longer do the indexing.
 *
 * The millisecond truncation is load-bearing and is preserved verbatim: pg hands timestamptz to
 * JS at millisecond precision, so comparing an untruncated µs-precision column against a
 * millisecond cursor lets the boundary row reappear on the next page. Truncating BOTH sides is
 * what makes the page boundary stable.
 */

/** The keyset a cursor encodes: a timestamp plus a unique tie-break within that timestamp. */
export interface Keyset {
  createdAt: string
  /** The tie-break value — a uuid `id` in most stores, `organisation_id` (text) in one. */
  id: string
}

/** Opaque, order-preserving cursor. base64url of `<createdAt>|<id>`. */
export function encodeCursor(k: Keyset): string {
  return Buffer.from(`${k.createdAt}|${k.id}`, 'utf8').toString('base64url')
}

/** Inverse of {@link encodeCursor}. Returns null for anything malformed — a bad cursor is a
 *  client error that degrades to "first page", never a 500. */
export function decodeCursor(cursor: string): Keyset | null {
  try {
    const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
    return createdAt && id ? { createdAt, id } : null
  } catch {
    return null
  }
}

export interface KeysetOptions {
  /** 'asc' → `>` with `ORDER BY ... ASC`; 'desc' → `<` with `ORDER BY ... DESC`. */
  direction?: 'asc' | 'desc'
  /** Tie-break column. Default `id`. */
  column?: string
  /** Postgres cast for the tie-break bind. Default `uuid`; pass null for a text column. */
  cast?: string | null
}

/**
 * Build the `(created_at, id) > (...)` keyset PREDICATE and append its two binds to `params`.
 *
 * Returns the bare predicate with no leading conjunction: most stores collect predicates into a
 * `where[]` they later `join(' AND ')`, while `consent-events` interpolates a single fragment and
 * prepends its own `AND`. Baking in a conjunction would suit exactly one of them.
 *
 * Returns '' when there is no cursor.
 *
 * The caller passes the SAME array it will hand to `query()`; this function mutates it. That is
 * deliberate — it is the only way the placeholder numbers and the bind positions cannot drift
 * apart (see divergence 3 above).
 */
export function keysetClause(params: unknown[], after: Keyset | null, options: KeysetOptions = {}): string {
  if (!after) return ''
  const { direction = 'asc', column = 'id', cast = 'uuid' } = options
  const op = direction === 'desc' ? '<' : '>'
  params.push(after.createdAt, after.id)
  // Placeholders derived from the push we just made — never from a caller's arithmetic.
  const tsIndex = params.length - 1
  const idIndex = params.length
  const idBind = cast ? `$${idIndex}::${cast}` : `$${idIndex}`
  return `(date_trunc('milliseconds', created_at), ${column}) ${op} ($${tsIndex}::timestamptz, ${idBind})`
}

/** The matching ORDER BY fragment — kept next to the predicate so a store cannot page one way
 *  and sort the other, which silently returns rows in an order the cursor does not follow. */
export function keysetOrderBy(options: KeysetOptions = {}): string {
  const { direction = 'asc', column = 'id' } = options
  const suffix = direction === 'desc' ? ' DESC' : ''
  return `date_trunc('milliseconds', created_at)${suffix}, ${column}${suffix}`
}

/**
 * Standard page-slicing: stores select `limit + 1` rows to detect a further page without a
 * second COUNT query. Returns the trimmed rows plus the next cursor (null on the last page).
 */
export function paginate<T>(rows: T[], limit: number, key: (row: T) => Keyset): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items[items.length - 1]
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(key(last)) : null
  }
}
