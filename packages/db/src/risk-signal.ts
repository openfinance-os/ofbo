import pg from 'pg'

/**
 * BACKOFFICE-80: persists Risk View signals (risk_signal table) under the
 * constrained ofbo_app role — structural match for the BFF RiskSignalSink.
 */

export interface RiskSignalSinkEvent {
  signal_type: string
  severity: string
  acting_principal: string
  summary: string
  trace_id: string
}

export class PgRiskSignalEmitter {
  private readonly pool: pg.Pool
  constructor(databaseUrl: string, private readonly config: { bankId: string; channel: string }) {
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
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
