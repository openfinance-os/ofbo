import { describe, expect, it } from 'vitest'
import { IdempotencyCache } from '../src/idempotency.js'

/**
 * Direct unit cover for the IdempotencyCache (HARNESS-04 mutation-gate companion).
 * The cache was only exercised indirectly via route specs, so the binding **24-hour**
 * dedup window (`WINDOW_MS`) and the injected-clock default had no asserting test —
 * mutation testing flagged the exact-24h boundary and the `() => Date.now()` default as
 * surviving mutants. These tests pin the window precisely (a two-sided boundary check) so
 * any change to the dedup window, or loss of the default clock, fails CI.
 */
const DAY_MS = 24 * 60 * 60 * 1000

describe('IdempotencyCache — binding 24h dedup window', () => {
  it('replays a cached 2xx entry within the window', () => {
    let now = 1_000_000
    const cache = new IdempotencyCache(() => now)
    cache.set('k', 200, { ok: true })
    now += DAY_MS - 1 // one ms before the window closes
    expect(cache.get('k')).toEqual({ status: 200, body: { ok: true }, created_at_ms: 1_000_000 })
  })

  it('keeps an entry at the last in-window millisecond and drops it one ms past 24h', () => {
    let now = 0
    const cache = new IdempotencyCache(() => now)
    cache.set('k', 201, { id: 'x' })
    now = DAY_MS - 1
    expect(cache.get('k')).not.toBeNull() // still inside the 24h window
    now = DAY_MS + 1
    expect(cache.get('k')).toBeNull() // window has passed → pruned
  })

  it('returns null for an unknown key', () => {
    const cache = new IdempotencyCache(() => 0)
    expect(cache.get('nope')).toBeNull()
  })

  it('defaults to a real wall-clock when no clock is injected', () => {
    const cache = new IdempotencyCache() // exercises the default `() => Date.now()`
    cache.set('k', 200, { ok: 1 })
    const got = cache.get('k')
    expect(got?.status).toBe(200)
    expect(got?.body).toEqual({ ok: 1 })
    // a real numeric timestamp (a lost default clock would record `undefined`)
    expect(typeof got?.created_at_ms).toBe('number')
    expect(got?.created_at_ms).toBeGreaterThan(0)
  })
})
