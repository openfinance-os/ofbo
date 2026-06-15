import pg from 'pg'
import type { LineageSink } from './lineage.js'

/**
 * BACKOFFICE-12 — persisted configurable break thresholds per fee class. The
 * reconciliation engine reads the current set at run time (so edits take effect
 * next run, never retroactively). Writes run as the constrained ofbo_app role
 * under RLS and emit BCBS 239 lineage at write time (best-effort — the regulated
 * write never depends on catalogue availability).
 */

/** The five reconciliation fee classes (matches the spec LineType enum + the DB
 *  CHECK constraint). Typed as a literal union so the store is structurally a
 *  BreakThreshold source for the engine. */
export type ThresholdFeeClass = 'nebras_fees' | 'payment_settlement' | 'consent_record' | 'tpp_aas_pass_through' | 'lfi_access_log'
export type ThresholdUnit = 'aed' | 'count'

export interface StoredThreshold {
  fee_class: ThresholdFeeClass
  threshold_value: number
  unit: ThresholdUnit
  updated_by: string
  updated_at: string
}

export interface ThresholdInput {
  fee_class: string
  threshold_value: number
  unit: string
}

const THRESHOLD_COLUMNS = ['bank_id', 'channel', 'fee_class', 'threshold_value', 'unit', 'updated_by']
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v))

function toThreshold(r: Record<string, unknown>): StoredThreshold {
  return {
    fee_class: r.fee_class as ThresholdFeeClass,
    threshold_value: Number(r.threshold_value),
    unit: r.unit as ThresholdUnit,
    updated_by: r.updated_by as string,
    updated_at: iso(r.updated_at)
  }
}

export class PgReconciliationThresholdStore {
  private readonly pool: pg.Pool
  constructor(
    databaseUrl: string,
    private readonly config: { bankId: string; channel: string },
    private readonly lineage?: LineageSink
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

  async list(): Promise<StoredThreshold[]> {
    const rows = await this.asApp((c) =>
      c.query(`SELECT fee_class, threshold_value, unit, updated_by, updated_at FROM reconciliation_threshold ORDER BY fee_class`)
    )
    return rows.rows.map(toThreshold)
  }

  /** Upsert each threshold (one row per fee_class) and return the full current set. */
  async replaceAll(thresholds: ThresholdInput[], updatedBy: string, _traceId: string): Promise<StoredThreshold[]> {
    const out = await this.asApp(async (c) => {
      for (const t of thresholds) {
        await c.query(
          `INSERT INTO reconciliation_threshold (bank_id, channel, fee_class, threshold_value, unit, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (bank_id, fee_class)
           DO UPDATE SET threshold_value = EXCLUDED.threshold_value, unit = EXCLUDED.unit, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [this.config.bankId, this.config.channel, t.fee_class, t.threshold_value, t.unit, updatedBy]
        )
      }
      const rows = await c.query(`SELECT fee_class, threshold_value, unit, updated_by, updated_at FROM reconciliation_threshold ORDER BY fee_class`)
      return rows.rows.map(toThreshold)
    })
    // BCBS 239 lineage at write time — best-effort.
    try {
      await this.lineage?.emitLineage({
        table: 'reconciliation_threshold',
        columns: THRESHOLD_COLUMNS,
        source: 'bff-reconciliation-threshold-store',
        trace_id: _traceId
      })
    } catch {
      /* catalogue unavailable — write stands; Q4.5 surfaces persistent gaps */
    }
    return out
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
