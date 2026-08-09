// CODE-02 — in-memory store(s) lifted verbatim out of services/bff/src/risk-signals/service.ts.
// Behaviour unchanged; see ./README.md for why they live outside src/.
import type { RiskSignalStore } from '../src/risk-signals/service.js'
import type { StoredRiskSignal, RiskSignalListQuery, RiskSignalPage } from '@ofbo/db'

export class InMemoryRiskSignalStore implements RiskSignalStore {
  constructor(private readonly rows: StoredRiskSignal[] = []) {}
  async listSignals(query: RiskSignalListQuery): Promise<RiskSignalPage> {
    let rows = [...this.rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    if (query.signal_type) rows = rows.filter((r) => r.signal_type === query.signal_type)
    if (query.severity) rows = rows.filter((r) => r.severity === query.severity)
    if (query.status) rows = rows.filter((r) => r.status === query.status)
    return { rows, next_cursor: null }
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
