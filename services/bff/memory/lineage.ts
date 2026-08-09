// CODE-02 — in-memory store(s) lifted verbatim out of services/bff/src/lineage/service.ts.
// Behaviour unchanged; see ./README.md for why they live outside src/.
import type { LineageReader } from '../src/lineage/service.js'
import type { TableLineage } from '@ofbo/db'

export class InMemoryLineageReader implements LineageReader {
  constructor(private readonly events: Record<string, TableLineage> = {}) {}
  async readTable(tableName: string): Promise<TableLineage> {
    return (
      this.events[tableName] ?? { table_name: tableName, columns: [], sources: [], event_count: 0, first_seen: null, last_seen: null, recent: [] }
    )
  }
}
