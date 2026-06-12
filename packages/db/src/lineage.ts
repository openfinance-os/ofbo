import pg from 'pg'

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
      await c.query('BEGIN')
      await c.query('SET LOCAL ROLE ofbo_app')
      await c.query(`SELECT set_config('app.bank_id', $1, true)`, [this.config.bankId])
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

/** Q4.5 (BCBS 239) validation: every Back Office table with rows must have lineage events. */
export async function validateLineageCoverage(
  databaseUrl: string
): Promise<{ covered: string[]; gaps: string[] }> {
  const pool = new pg.Pool({ connectionString: databaseUrl })
  try {
    const tables = ['reconciliation_log', 'reconciliation_break', 'dispute_case', 'audit_high_sensitivity', 'compliance_report', 'risk_signal', 'approval_request', 'query_purpose_registry', 'tpp_counterparty']
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
