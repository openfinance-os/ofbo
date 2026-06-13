import pg from 'pg'
import type { LineageSink } from './lineage.js'

/**
 * BACKOFFICE-80: persists Risk View signals (risk_signal table) under the
 * constrained ofbo_app role — structural match for the BFF RiskSignalSink.
 * M1-LINEAGE-RISK-SIGNAL: emits column-level lineage at write time (BCBS 239),
 * exactly as the audit path does — best-effort, the regulated write never
 * depends on catalogue availability.
 */

export interface RiskSignalSinkEvent {
  signal_type: string
  severity: string
  acting_principal: string
  summary: string
  trace_id: string
}

const RISK_SIGNAL_COLUMNS = ['bank_id', 'channel', 'signal_type', 'severity', 'status', 'signal_data']

export class PgRiskSignalEmitter {
  private readonly pool: pg.Pool
  constructor(
    databaseUrl: string,
    private readonly config: { bankId: string; channel: string },
    private readonly lineage?: LineageSink
  ) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
  }

  async record(event: RiskSignalSinkEvent): Promise<void> {
    const c = await this.pool.connect()
    try {
      await c.query('BEGIN')
      await c.query('SET LOCAL ROLE ofbo_app')
      await c.query(`SELECT set_config('app.bank_id', $1, true)`, [this.config.bankId])
      await c.query(
        `INSERT INTO risk_signal (bank_id, channel, signal_type, severity, status, signal_data)
         VALUES ($1, $2, $3, $4, 'open', $5::jsonb)`,
        [
          this.config.bankId,
          this.config.channel,
          event.signal_type,
          event.severity,
          JSON.stringify({ acting_principal: event.acting_principal, summary: event.summary, trace_id: event.trace_id })
        ]
      )
      await c.query('COMMIT')
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined)
      throw e
    } finally {
      c.release()
    }
    // BCBS 239 (M1-LINEAGE-RISK-SIGNAL): lineage at write time. Best-effort by
    // design — the regulated write itself never depends on catalogue availability.
    try {
      await this.lineage?.emitLineage({
        table: 'risk_signal',
        columns: RISK_SIGNAL_COLUMNS,
        source: 'bff-risk-signal-emitter',
        trace_id: event.trace_id
      })
    } catch {
      /* catalogue unavailable — write stands; Q4.5 surfaces persistent gaps */
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
