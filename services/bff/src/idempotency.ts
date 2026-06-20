/**
 * Idempotency-Key handling (binding convention: required on every mutating
 * endpoint, 24h dedup window). In the demo profile the BFF is the first
 * enforcement layer, so replay enforcement lives here. Deployed entries use
 * the durable Pg store (@ofbo/db PgIdempotencyStore — isolate/restart-proof);
 * this in-memory cache remains the no-database default for tests/local dev.
 */

import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { errorEnvelope, DOCS_BASE } from './envelope.js'

interface CachedResponse {
  status: number
  body: unknown
  created_at_ms: number
}

/** What the routes need from a replay store; PgIdempotencyStore matches structurally. */
export interface IdempotencyStore {
  get(key: string): Promise<{ status: number; body: unknown } | null> | { status: number; body: unknown } | null
  set(key: string, status: number, body: unknown): Promise<void> | void
}

const WINDOW_MS = 24 * 60 * 60 * 1000

export class IdempotencyCache implements IdempotencyStore {
  private readonly entries = new Map<string, CachedResponse>()
  constructor(private readonly now: () => number = () => Date.now()) {}

  private prune() {
    const cutoff = this.now() - WINDOW_MS
    for (const [k, v] of this.entries) if (v.created_at_ms < cutoff) this.entries.delete(k)
  }

  get(key: string): CachedResponse | null {
    this.prune()
    return this.entries.get(key) ?? null
  }

  set(key: string, status: number, body: unknown): void {
    this.entries.set(key, { status, body, created_at_ms: this.now() })
  }
}

type IdempotentHandler = (c: Context, params: Record<string, string>) => Promise<Response>

/** The binding 400 for a mutating request that omits the Idempotency-Key header.
 *  Built per-call so request_id/timestamp in `meta` stay fresh on every response. */
export const missingIdempotencyKey = () =>
  errorEnvelope(
    'BACKOFFICE.MISSING_IDEMPOTENCY_KEY',
    'The Idempotency-Key header is required on every mutating endpoint.',
    'Send a unique Idempotency-Key; replays within 24h return the original result.',
    DOCS_BASE
  )

/**
 * Replay mechanics for routes that must parse/validate their body BEFORE they can
 * compute the dedup key (so they can't use `replayable`, which keys before the handler
 * runs): given an already-built cacheKey, replay a cached 2xx verbatim inside the 24h
 * window, otherwise run `produce` and cache its 2xx outcome. The caller still does the
 * missing-key check (see `missingIdempotencyKey`).
 */
export async function replayCached(
  c: Context,
  store: IdempotencyStore,
  cacheKey: string,
  produce: () => Promise<Response>
): Promise<Response> {
  const cached = await store.get(cacheKey)
  if (cached) return c.json(cached.body, cached.status as ContentfulStatusCode)
  const res = await produce()
  if (res.status >= 200 && res.status < 300) await store.set(cacheKey, res.status, await res.clone().json())
  return res
}

/**
 * Wrap a mutating handler with the binding Idempotency-Key contract: require the
 * header (else 400), replay a cached 2xx verbatim inside the 24h window, and cache
 * fresh 2xx outcomes. `buildKey` lets each route keep its exact dedup-key shape
 * (route prefix + scoping params + subject + key) — the replay plumbing is shared.
 */
export function replayable(
  store: IdempotencyStore,
  buildKey: (params: Record<string, string>, subject: string, key: string) => string,
  handler: IdempotentHandler
): IdempotentHandler {
  return async (c, params) => {
    const key = c.req.header('idempotency-key')
    if (!key) return c.json(missingIdempotencyKey(), 400)
    const cacheKey = buildKey(params, c.get('principal').subject, key)
    return replayCached(c, store, cacheKey, () => handler(c, params))
  }
}
