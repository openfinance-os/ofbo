/**
 * Idempotency-Key handling (binding convention: required on every mutating
 * endpoint, 24h dedup window). In the demo profile the BFF is the first
 * enforcement layer, so replay enforcement lives here. Deployed entries use
 * the durable Pg store (@ofbo/db PgIdempotencyStore — isolate/restart-proof);
 * this in-memory cache remains the no-database default for tests/local dev.
 */

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
