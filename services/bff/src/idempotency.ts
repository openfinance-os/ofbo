/**
 * Idempotency-Key handling (binding convention: required on every mutating
 * endpoint, 24h dedup window). In the demo profile the BFF is the first
 * enforcement layer, so the replay cache lives here; a durable store replaces
 * the in-memory map when the demo deployment lands (sleep-tolerant hosting).
 */

interface CachedResponse {
  status: number
  body: unknown
  created_at_ms: number
}

const WINDOW_MS = 24 * 60 * 60 * 1000

export class IdempotencyCache {
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
