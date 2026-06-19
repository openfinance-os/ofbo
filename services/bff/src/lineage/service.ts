import type { TableLineage } from '@ofbo/db'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import type { HighClassAuditSink } from '../high-class-audit.js'

/**
 * BACKOFFICE-49 — read the column-level BCBS 239 lineage tree for a Back Office table
 * (via the data-catalogue / P7; demo reads the local lineage_events). compliance:reports:read
 * (the Compliance audience), enforced at the BFF middleware and re-checked here. The access
 * itself is logged (High-class audit) — lineage carries no PSU PII.
 */

export const LINEAGE_READ_SCOPE = 'compliance:reports:read'

export class LineageError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface LineageReader {
  readTable(tableName: string): Promise<TableLineage>
}

/** No-database default (tests / local dev). The worker wires PgLineageReader. */
export class InMemoryLineageReader implements LineageReader {
  constructor(private readonly events: Record<string, TableLineage> = {}) {}
  async readTable(tableName: string): Promise<TableLineage> {
    return (
      this.events[tableName] ?? { table_name: tableName, columns: [], sources: [], event_count: 0, first_seen: null, last_seen: null, recent: [] }
    )
  }
}

export interface LineageServiceDeps {
  reader: LineageReader
  audit: HighClassAuditSink
}

export class LineageService {
  constructor(private readonly deps: LineageServiceDeps) {}

  async readTable(principal: Principal, tableName: string, traceId: string): Promise<TableLineage> {
    assertScope(principal, LINEAGE_READ_SCOPE)
    if (!tableName || !/^[a-z_][a-z0-9_]*$/.test(tableName)) {
      throw new LineageError('BACKOFFICE.INVALID_TABLE_NAME', 'table_name must be a valid identifier.', 400)
    }
    const lineage = await this.deps.reader.readTable(tableName)
    if (lineage.event_count === 0) {
      throw new LineageError('BACKOFFICE.LINEAGE_NOT_FOUND', `No lineage recorded for table '${tableName}'.`, 404)
    }
    await this.deps.audit.emit({
      event_type: 'lineage_viewed',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: LINEAGE_READ_SCOPE,
      request_trace_id: traceId,
      request_body: { table_name: tableName, event_count: lineage.event_count },
      response_status: 200,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })
    return lineage
  }
}
