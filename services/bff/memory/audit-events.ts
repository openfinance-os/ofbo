// CODE-02 — in-memory store(s) lifted verbatim out of services/bff/src/audit/events.ts.
// Behaviour unchanged; see ./README.md for why they live outside src/.
import type { AuditEventReader } from '../src/audit/events.js'
import type { StoredAuditEvent, AuditEventQuery } from '@ofbo/db'

export class InMemoryAuditEventReader implements AuditEventReader {
  constructor(private readonly rows: StoredAuditEvent[] = []) {}
  async query(filters: AuditEventQuery): Promise<{ rows: StoredAuditEvent[]; next_cursor: string | null }> {
    let rows = [...this.rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    if (filters.acting_principal) rows = rows.filter((r) => r.acting_principal === filters.acting_principal)
    if (filters.target_psu_identifier) rows = rows.filter((r) => r.target_psu_identifier === filters.target_psu_identifier)
    if (filters.event_type) rows = rows.filter((r) => r.event_type === filters.event_type)
    return { rows: rows.slice(0, Math.min(Math.max(filters.limit ?? 50, 1), 200)), next_cursor: null }
  }
  async get(id: string): Promise<StoredAuditEvent | null> {
    return this.rows.find((r) => r.id === id) ?? null
  }
}
