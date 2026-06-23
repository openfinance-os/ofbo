import pg from 'pg'
import { beginAppTx } from './tenant-tx.js'

/**
 * BACKOFFICE-49: demo-profile P7 adapter — column-level lineage written to the
 * local lineage_events table at write time (never retrofitted). Structural
 * match for the ports LineagePort. The Q4.5 CI gate calls
 * validateLineageCoverage to prove every written table emits lineage.
 */

export interface LineageEvent {
  table: string
  columns: string[]
  source: string
  trace_id: string
}

export interface LineageSink {
  emitLineage(event: LineageEvent): Promise<void>
}

export class PgLineageEmitter implements LineageSink {
  private readonly pool: pg.Pool
  constructor(databaseUrl: string, private readonly config: { bankId: string; channel: string }) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
  }

  async emitLineage(event: LineageEvent): Promise<void> {
    const c = await this.pool.connect()
    try {
      await c.query(beginAppTx(this.config.bankId))
      await c.query(
        `INSERT INTO lineage_events (bank_id, channel, table_name, columns, source, trace_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [this.config.bankId, this.config.channel, event.table, event.columns, event.source, event.trace_id]
      )
      await c.query('COMMIT')
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined)
      throw e
    } finally {
      c.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

/** BACKOFFICE-49 — column-level lineage tree for one Back Office table, read from
 *  lineage_events (the demo's local stand-in for the P7 enterprise data catalogue). */
export interface TableLineage {
  table_name: string
  columns: string[]
  sources: string[]
  event_count: number
  first_seen: string | null
  last_seen: string | null
  recent: { columns: string[]; source: string; trace_id: string; created_at: string }[]
}

export class PgLineageReader {
  private readonly pool: pg.Pool
  constructor(databaseUrl: string, private readonly config: { bankId: string }) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
  }

  async readTable(tableName: string): Promise<TableLineage> {
    const c = await this.pool.connect()
    try {
      await c.query(beginAppTx(this.config.bankId))
      const res = await c.query(
        `SELECT columns, source, trace_id, created_at FROM lineage_events
         WHERE table_name = $1 ORDER BY created_at DESC LIMIT 50`,
        [tableName]
      )
      await c.query('COMMIT')
      const rows = res.rows
      const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v))
      const columns = [...new Set(rows.flatMap((r) => (r.columns as string[]) ?? []))].sort()
      const sources = [...new Set(rows.map((r) => r.source as string))].sort()
      const times = rows.map((r) => iso(r.created_at)).sort()
      return {
        table_name: tableName,
        columns,
        sources,
        event_count: rows.length,
        first_seen: times[0] ?? null,
        last_seen: times[times.length - 1] ?? null,
        recent: rows.slice(0, 20).map((r) => ({ columns: (r.columns as string[]) ?? [], source: r.source as string, trace_id: r.trace_id as string, created_at: iso(r.created_at) }))
      }
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined)
      throw e
    } finally {
      c.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

/** Q4.5 (BCBS 239) validation: every Back Office table with rows must have lineage events. */
export async function validateLineageCoverage(
  databaseUrl: string
): Promise<{ covered: string[]; gaps: string[] }> {
  const pool = new pg.Pool({ connectionString: databaseUrl })
  try {
    const tables = ['reconciliation_log', 'reconciliation_break', 'reconciliation_threshold', 'dispute_case', 'audit_high_sensitivity', 'compliance_report', 'risk_signal', 'approval_request', 'query_purpose_registry', 'tpp_counterparty', 'billing_record_set', 'invoice_run', 'nebras_ingest_snapshot', 'nebras_report_aggregate', 'platform_certification', 'platform_outage', 'agent_registry']
    const covered: string[] = []
    const gaps: string[] = []
    for (const t of tables) {
      const rows = await pool.query(`SELECT EXISTS (SELECT 1 FROM ${t}) AS has_rows`)
      if (!rows.rows[0].has_rows) continue
      const lineage = await pool.query(`SELECT EXISTS (SELECT 1 FROM lineage_events WHERE table_name = $1) AS has_lineage`, [t])
      if (lineage.rows[0].has_lineage) covered.push(t)
      else gaps.push(t)
    }
    return { covered, gaps }
  } finally {
    await pool.end()
  }
}

/**
 * Tables that legitimately carry rows without write-time lineage today, each
 * mapped to the story that closes the gap. The Q4.5 gate fails on ANY gap not
 * listed here — so a real regression (a write-path table that stops emitting
 * lineage) blocks merge. Empty as of BACKOFFICE-71: the consuming-TPP registry's
 * write path + the seed now emit tpp_counterparty lineage, closing the last gap.
 */
export const KNOWN_LINEAGE_GAPS: Record<string, string> = {}

export interface LineageGateResult {
  ok: boolean
  covered: string[]
  allowedGaps: string[]
  unexpectedGaps: string[]
  /** Allowlisted tables now covered — the allowlist entry can be removed. */
  staleAllowlist: string[]
}

/**
 * Q4.5 BCBS 239 gate: pass only when every table-with-rows emits lineage, save
 * for the documented known-pending gaps. Pure — the CI step feeds it a coverage
 * report from validateLineageCoverage.
 */
export function evaluateLineageGate(
  report: { covered: string[]; gaps: string[] },
  allowlist: Record<string, string> = KNOWN_LINEAGE_GAPS
): LineageGateResult {
  const allowed = new Set(Object.keys(allowlist))
  const unexpectedGaps = report.gaps.filter((g) => !allowed.has(g))
  const allowedGaps = report.gaps.filter((g) => allowed.has(g))
  const staleAllowlist = [...allowed].filter((t) => report.covered.includes(t))
  return {
    ok: unexpectedGaps.length === 0,
    covered: report.covered,
    allowedGaps,
    unexpectedGaps,
    staleAllowlist
  }
}
