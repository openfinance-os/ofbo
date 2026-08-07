import { describe, expect, it } from 'vitest'
import { decodeCursor, encodeCursor, keysetClause, keysetOrderBy, paginate } from '../src/keyset.js'

const TS = '2026-06-01T08:00:00.000Z'
const ID = '5f0e63c0-0000-4000-8000-0000000000a1'

describe('CODE-01 — shared cursor/keyset pagination', () => {
  describe('cursor round-trip', () => {
    it('encodes and decodes a keyset', () => {
      expect(decodeCursor(encodeCursor({ createdAt: TS, id: ID }))).toEqual({ createdAt: TS, id: ID })
    })

    it('is base64url — no +, / or = to break a query string', () => {
      expect(encodeCursor({ createdAt: TS, id: ID })).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it('degrades a malformed cursor to null (first page), never throws', () => {
      for (const bad of ['', 'not-base64!!', Buffer.from('no-separator').toString('base64url'), Buffer.from('|').toString('base64url')]) {
        expect(decodeCursor(bad)).toBeNull()
      }
    })
  })

  describe('keysetClause — the parameter-indexing trap this helper exists to remove', () => {
    it('returns no predicate when there is no cursor', () => {
      const params: unknown[] = ['bank']
      expect(keysetClause(params, null)).toBe('')
      expect(params).toEqual(['bank']) // and binds nothing
    })

    // The 15-store convention: binds pushed, then referenced as length-1 / length.
    it('numbers placeholders against the params it appended (params already present)', () => {
      const params: unknown[] = ['a', 'b']
      const clause = keysetClause(params, { createdAt: TS, id: ID })
      expect(clause).toBe(`(date_trunc('milliseconds', created_at), id) > ($3::timestamptz, $4::uuid)`)
      expect(params).toEqual(['a', 'b', TS, ID])
    })

    // The consent-events convention: a DIFFERENT arithmetic (+1/+2) over a longer prefix.
    // Both stores were correct in place and neither survived being pasted into the other —
    // which is why callers no longer do this arithmetic at all. Same helper, same call, and
    // the placeholders track the actual bind positions in both shapes.
    it('stays correct for a longer parameter prefix (the consent-events shape)', () => {
      const params: unknown[] = ['psu-1', 'consent_revoked', 'consent_created', 'consent_expired']
      const clause = keysetClause(params, { createdAt: TS, id: ID })
      expect(clause).toBe(`(date_trunc('milliseconds', created_at), id) > ($5::timestamptz, $6::uuid)`)
      expect(params[4]).toBe(TS)
      expect(params[5]).toBe(ID)
    })

    it('descending pages use < (so DESC ordering does not re-serve the boundary row)', () => {
      const params: unknown[] = ['x']
      expect(keysetClause(params, { createdAt: TS, id: ID }, { direction: 'desc' })).toContain(') < (')
    })

    // tpp_counterparty keys on organisation_id, which is TEXT. Casting it to uuid would fail at
    // runtime — the divergence a hardcoded helper would have erased.
    it('supports a non-uuid tie-break column with no cast', () => {
      const params: unknown[] = ['x']
      const clause = keysetClause(params, { createdAt: TS, id: 'org-001' }, { column: 'organisation_id', cast: null })
      expect(clause).toBe(`(date_trunc('milliseconds', created_at), organisation_id) > ($2::timestamptz, $3)`)
      expect(clause).not.toContain('::uuid')
    })

    it('always truncates created_at to milliseconds on the column side', () => {
      // pg hands timestamptz to JS at ms precision; comparing an untruncated µs column against a
      // ms cursor lets the boundary row reappear on the next page.
      expect(keysetClause([], { createdAt: TS, id: ID })).toContain(`date_trunc('milliseconds', created_at)`)
    })
  })

  describe('keysetOrderBy — must agree with the predicate direction', () => {
    it('ascending by default', () => {
      expect(keysetOrderBy()).toBe(`date_trunc('milliseconds', created_at), id`)
    })

    it('descending applies DESC to BOTH key parts', () => {
      // Sorting only the timestamp DESC while the tie-break stays ASC produces an order the
      // cursor comparison does not follow — rows silently skipped or repeated at page edges.
      expect(keysetOrderBy({ direction: 'desc' })).toBe(`date_trunc('milliseconds', created_at) DESC, id DESC`)
    })

    it('carries a custom tie-break column', () => {
      expect(keysetOrderBy({ column: 'organisation_id' })).toContain('organisation_id')
    })
  })

  describe('paginate', () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({ id: `id-${i}`, created_at: TS }))
    const key = (r: { id: string; created_at: string }) => ({ createdAt: r.created_at, id: r.id })

    it('trims the probe row and emits a cursor pointing at the last RETURNED row', () => {
      const { items, nextCursor } = paginate(rows, 3, key)
      expect(items).toHaveLength(3)
      expect(nextCursor).not.toBeNull()
      // The cursor must be the last item SERVED (id-2), not the probe row (id-3) — otherwise
      // the next page skips a row.
      expect(decodeCursor(nextCursor!)).toEqual({ createdAt: TS, id: 'id-2' })
    })

    it('returns a null cursor on the last page', () => {
      expect(paginate(rows, 4, key).nextCursor).toBeNull()
      expect(paginate(rows, 10, key).nextCursor).toBeNull()
    })

    it('handles an empty result', () => {
      expect(paginate([], 10, key)).toEqual({ items: [], nextCursor: null })
    })
  })
})
