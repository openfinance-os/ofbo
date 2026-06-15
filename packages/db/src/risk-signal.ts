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
  /** BACKOFFICE-36 — liability proximity ref (issue × liable party × AED). */
  nebras_liability_event_ref?: string
  client_id?: string
  /** BACKOFFICE-37 — cross-run dedup key for the streaming anomaly detector (in signal_data). */
  dedup_key?: string
  /** BACKOFFICE-37 — extra signal context (e.g. session_flagged), merged into signal_data. */
  context?: Record<string, unknown>
}

const RISK_SIGNAL_COLUMNS = ['bank_id', 'channel', 'signal_type', 'severity', 'status', 'signal_data', 'nebras_liability_event_ref']

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
        `INSERT INTO risk_signal (bank_id, channel, signal_type, severity, status, client_id, signal_data, nebras_liability_event_ref)
         VALUES ($1, $2, $3, $4, 'open', $5, $6::jsonb, $7)`,
        [
          this.config.bankId,
          this.config.channel,
          event.signal_type,
          event.severity,
          event.client_id ?? null,
          JSON.stringify({ acting_principal: event.acting_principal, summary: event.summary, trace_id: event.trace_id, ...(event.dedup_key ? { dedup_key: event.dedup_key } : {}), ...(event.context ?? {}) }),
          event.nebras_liability_event_ref ?? null
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

/**
 * BACKOFFICE-30 — Risk View read aggregates over risk_signal. Read-only, RLS-bound
 * (ofbo_app + tenancy). Surfaces typed fields + counts only — never the raw
 * signal_data blob (the per-signal context lives behind the risk-signals detail
 * endpoint). "Active" = not in a closed/false-positive terminal state.
 */
export interface RiskSignalSummary {
  active_total: number
  by_type: Record<string, number>
  by_severity: Record<string, number>
  by_status: Record<string, number>
}
export interface LiabilityMonitor {
  open_count: number
  by_severity: Record<string, number>
  recent: { nebras_liability_event_ref: string | null; severity: string; created_at: string }[]
}
export interface RiskSignalHeader {
  id: string
  signal_type: string
  severity: string
  status: string
  client_id: string | null
  nebras_liability_event_ref: string | null
  created_at: string
}

const ACTIVE = `status NOT IN ('closed_actioned','closed_no_action','false_positive')`
const isoR = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v))
const tallyR = (rows: { k: string; n: string | number }[]): Record<string, number> =>
  rows.reduce<Record<string, number>>((acc, r) => ((acc[r.k] = Number(r.n)), acc), {})

export class PgRiskMetricsStore {
  private readonly pool: pg.Pool
  constructor(
    databaseUrl: string,
    private readonly config: { bankId: string; channel: string }
  ) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
  }

  private async asApp<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect()
    try {
      await c.query('BEGIN')
      await c.query('SET LOCAL ROLE ofbo_app')
      await c.query(`SELECT set_config('app.bank_id', $1, true)`, [this.config.bankId])
      const out = await fn(c)
      await c.query('COMMIT')
      return out
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined)
      throw e
    } finally {
      c.release()
    }
  }

  async summary(): Promise<RiskSignalSummary> {
    return this.asApp(async (c) => {
      const [byType, bySeverity, byStatus] = await Promise.all([
        c.query(`SELECT signal_type AS k, count(*) AS n FROM risk_signal WHERE ${ACTIVE} GROUP BY signal_type`),
        c.query(`SELECT severity AS k, count(*) AS n FROM risk_signal WHERE ${ACTIVE} GROUP BY severity`),
        c.query(`SELECT status AS k, count(*) AS n FROM risk_signal GROUP BY status`)
      ])
      const byT = tallyR(byType.rows)
      return { active_total: Object.values(byT).reduce((a, b) => a + b, 0), by_type: byT, by_severity: tallyR(bySeverity.rows), by_status: tallyR(byStatus.rows) }
    })
  }

  async liabilityMonitor(): Promise<LiabilityMonitor> {
    return this.asApp(async (c) => {
      const [bySeverity, recent] = await Promise.all([
        c.query(`SELECT severity AS k, count(*) AS n FROM risk_signal WHERE signal_type = 'nebras_liability_approach' AND ${ACTIVE} GROUP BY severity`),
        c.query(`SELECT nebras_liability_event_ref, severity, created_at FROM risk_signal WHERE signal_type = 'nebras_liability_approach' AND ${ACTIVE} ORDER BY created_at DESC LIMIT 10`)
      ])
      const by = tallyR(bySeverity.rows)
      return {
        open_count: Object.values(by).reduce((a, b) => a + b, 0),
        by_severity: by,
        recent: recent.rows.map((r) => ({ nebras_liability_event_ref: (r.nebras_liability_event_ref as string) ?? null, severity: r.severity as string, created_at: isoR(r.created_at) }))
      }
    })
  }

  async recentActive(limit = 20): Promise<RiskSignalHeader[]> {
    const n = Math.min(Math.max(limit, 1), 100)
    return this.asApp(async (c) => {
      const res = await c.query(
        `SELECT id, signal_type, severity, status, client_id, nebras_liability_event_ref, created_at
           FROM risk_signal WHERE ${ACTIVE} ORDER BY created_at DESC LIMIT ${n}`
      )
      return res.rows.map((r) => ({
        id: r.id as string,
        signal_type: r.signal_type as string,
        severity: r.severity as string,
        status: r.status as string,
        client_id: (r.client_id as string) ?? null,
        nebras_liability_event_ref: (r.nebras_liability_event_ref as string) ?? null,
        created_at: isoR(r.created_at)
      }))
    })
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
