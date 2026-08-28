// CODE-02 — in-memory store(s) lifted verbatim out of services/bff/src/risk-signals/service.ts.
// Behaviour unchanged; see ./README.md for why they live outside src/.
import type { RiskSignalStore } from '../src/risk-signals/service.js'
import type { StoredRiskSignal, RiskSignalListQuery, RiskSignalPage } from '@ofbo/db'
import { encodeSignalCursor, decodeSignalCursor } from '@ofbo/db'

export class InMemoryRiskSignalStore implements RiskSignalStore {
  constructor(private readonly rows: StoredRiskSignal[] = []) {}

  /**
   * PAGINATED, like its Postgres sibling. It used to apply the filters and then return every
   * matching row with `next_cursor: null` — so the two adapters behind
   * `GET /back-office/risk-signals` disagreed about whether the endpoint was paginated at all, and
   * a client that follows the cursor was correct against one and a no-op against the other. This is
   * the default store whenever no `riskSignalStore` dep is wired, which is precisely the
   * configuration a demo runs in when it has no database.
   *
   * Same ordering (created_at DESC, id DESC), same `[1, 200]` clamp, same keyset cursor codec, same
   * `limit + 1` continuation detection — the port-contract rule is that an adapter passes the tests
   * its sibling passes, and pagination was the half this one did not implement.
   */
  async listSignals(query: RiskSignalListQuery): Promise<RiskSignalPage> {
    let rows = [...this.rows].sort((a, b) =>
      a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1
    )
    if (query.signal_type) rows = rows.filter((r) => r.signal_type === query.signal_type)
    if (query.severity) rows = rows.filter((r) => r.severity === query.severity)
    if (query.status) rows = rows.filter((r) => r.status === query.status)

    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
    const after = query.cursor ? decodeSignalCursor(query.cursor) : null
    if (after) {
      // Strictly AFTER the cursor row in the same DESC ordering the Postgres keyset clause uses.
      rows = rows.filter((r) => r.created_at < after.createdAt || (r.created_at === after.createdAt && r.id < after.id))
    }
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const last = page[page.length - 1]
    return {
      rows: page,
      next_cursor: hasMore && last ? encodeSignalCursor(last.created_at, last.id) : null
    }
  }
  async getSignal(id: string): Promise<StoredRiskSignal | null> {
    return this.rows.find((r) => r.id === id) ?? null
  }
  async updateSignalStatus(id: string, status: string): Promise<StoredRiskSignal | null> {
    const r = this.rows.find((x) => x.id === id)
    if (!r) return null
    r.status = status
    return r
  }
}
