import pg from 'pg'
import type { LineageSink } from './lineage.js'

/**
 * BACKOFFICE-32 — Nebras ingestion stores. nebras_ingest_snapshot (hot landing
 * for each polled TPP Reports / Dataset snapshot) and nebras_report_aggregate
 * (materialized aggregates the M4 analytics views read). Both mutable: writes run
 * as ofbo_app with the tenancy context set (RLS binds); column-level BCBS 239
 * lineage at write time. Synthetic Nebras data only — no PSU PII.
 */

export interface StoredSnapshot {
  snapshot_id: string
  source: string
  dataset_name: string | null
  period: string
  run_id: string
  published_at: string
  row_count: number
  rows: Record<string, unknown>[]
  freshness: string
  warm_export_state: string
  warm_object_key: string | null
  ingested_at: string
}

export interface SnapshotCreateInput {
  source: 'tpp_reports' | 'dataset'
  dataset_name?: string | null
  period: string
  run_id: string
  published_at: string
  rows: Record<string, unknown>[]
}

export interface StoredAggregate {
  aggregate_id: string
  period: string
  channel: string
  line_type: string
  total_fee_minor: number
  line_count: number
  currency: string
  source_published_at: string
  refreshed_at: string
  freshness: string
}

export interface AggregateInput {
  period: string
  channel: string
  line_type: string
  total_fee_minor: number
  line_count: number
  currency: string
  source_published_at: string
}

const SNAP_COLS = `id, source, dataset_name, period, run_id, published_at, row_count, rows, freshness, warm_export_state, warm_object_key, ingested_at`
const AGG_COLS = `id, period, channel, line_type, total_fee_minor, line_count, currency, source_published_at, refreshed_at, freshness`
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v))

function toSnapshot(r: Record<string, unknown>): StoredSnapshot {
  return {
    snapshot_id: r.id as string,
    source: r.source as string,
    dataset_name: (r.dataset_name as string) ?? null,
    period: r.period as string,
    run_id: r.run_id as string,
    published_at: iso(r.published_at),
    row_count: Number(r.row_count),
    rows: (r.rows as Record<string, unknown>[]) ?? [],
    freshness: r.freshness as string,
    warm_export_state: r.warm_export_state as string,
    warm_object_key: (r.warm_object_key as string) ?? null,
    ingested_at: iso(r.ingested_at)
  }
}
function toAggregate(r: Record<string, unknown>): StoredAggregate {
  return {
    aggregate_id: r.id as string,
    period: r.period as string,
    channel: r.channel as string,
    line_type: r.line_type as string,
    total_fee_minor: Number(r.total_fee_minor),
    line_count: Number(r.line_count),
    currency: (r.currency as string).trim(),
    source_published_at: iso(r.source_published_at),
    refreshed_at: iso(r.refreshed_at),
    freshness: r.freshness as string
  }
}

abstract class TenantStore {
  protected readonly pool: pg.Pool
  constructor(
    databaseUrl: string,
    protected readonly config: { bankId: string; channel: string },
    protected readonly lineage?: LineageSink
  ) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
  }
  protected async asApp<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
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
  protected async emit(table: string, columns: string[], traceId: string): Promise<void> {
    try {
      await this.lineage?.emitLineage({ table, columns, source: 'nebras-ingestion', trace_id: traceId })
    } catch {
      /* catalogue unavailable — the regulated write stands; Q4.5 surfaces persistent gaps */
    }
  }
  async close(): Promise<void> {
    await this.pool.end()
  }
}

const SNAP_LINEAGE = ['bank_id', 'channel', 'source', 'dataset_name', 'period', 'published_at', 'row_count', 'freshness']

export class PgNebrasSnapshotStore extends TenantStore {
  /** Idempotent on (bank_id, run_id): a re-run refreshes the landed rows in place. */
  async create(input: SnapshotCreateInput, traceId: string): Promise<{ snapshot: StoredSnapshot; created: boolean }> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `INSERT INTO nebras_ingest_snapshot (bank_id, channel, source, dataset_name, period, run_id, published_at, row_count, rows)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
         ON CONFLICT (bank_id, run_id) DO UPDATE
           SET rows = EXCLUDED.rows, row_count = EXCLUDED.row_count, published_at = EXCLUDED.published_at,
               freshness = 'fresh', warm_export_state = 'pending', ingested_at = now()
         RETURNING ${SNAP_COLS}, (xmax = 0) AS created`,
        [this.config.bankId, this.config.channel, input.source, input.dataset_name ?? null, input.period, input.run_id, input.published_at, input.rows.length, JSON.stringify(input.rows)]
      )
      return res.rows[0]
    })
    await this.emit('nebras_ingest_snapshot', SNAP_LINEAGE, traceId)
    return { snapshot: toSnapshot(row), created: row.created === true }
  }

  async markWarmExported(snapshotId: string, objectKey: string, traceId: string): Promise<StoredSnapshot | null> {
    const row = await this.asApp(async (c) =>
      (
        await c.query(
          `UPDATE nebras_ingest_snapshot SET warm_export_state = 'exported', warm_object_key = $2 WHERE id = $1 RETURNING ${SNAP_COLS}`,
          [snapshotId, objectKey]
        )
      ).rows[0] ?? null
    )
    if (row) await this.emit('nebras_ingest_snapshot', SNAP_LINEAGE, traceId)
    return row ? toSnapshot(row) : null
  }

  /** Most recent successful snapshot for a logical source — the last-good fallback. */
  async latestGood(source: string, period: string, datasetName?: string | null): Promise<StoredSnapshot | null> {
    const row = await this.asApp(async (c) =>
      (
        await c.query(
          `SELECT ${SNAP_COLS} FROM nebras_ingest_snapshot
            WHERE source = $1 AND period = $2 AND dataset_name IS NOT DISTINCT FROM $3 AND freshness = 'fresh'
            ORDER BY ingested_at DESC LIMIT 1`,
          [source, period, datasetName ?? null]
        )
      ).rows[0] ?? null
    )
    return row ? toSnapshot(row) : null
  }

  async get(id: string): Promise<StoredSnapshot | null> {
    const row = await this.asApp(async (c) => (await c.query(`SELECT ${SNAP_COLS} FROM nebras_ingest_snapshot WHERE id = $1`, [id])).rows[0] ?? null)
    return row ? toSnapshot(row) : null
  }

  async listForPeriod(period: string): Promise<StoredSnapshot[]> {
    const rows = await this.asApp(async (c) =>
      (await c.query(`SELECT ${SNAP_COLS} FROM nebras_ingest_snapshot WHERE period = $1 ORDER BY ingested_at DESC`, [period])).rows
    )
    return rows.map(toSnapshot)
  }
}

const AGG_LINEAGE = ['bank_id', 'channel', 'period', 'line_type', 'total_fee_minor', 'line_count', 'source_published_at', 'freshness']

export class PgNebrasAggregateStore extends TenantStore {
  /** Refresh the materialized aggregates for a period — upsert each dimension to fresh. */
  async refresh(inputs: AggregateInput[], traceId: string): Promise<StoredAggregate[]> {
    if (inputs.length === 0) return []
    const rows = await this.asApp(async (c) => {
      const out: Record<string, unknown>[] = []
      for (const a of inputs) {
        const res = await c.query(
          `INSERT INTO nebras_report_aggregate (bank_id, channel, period, line_type, total_fee_minor, line_count, currency, source_published_at, freshness)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'fresh')
           ON CONFLICT (bank_id, period, channel, line_type) DO UPDATE
             SET total_fee_minor = EXCLUDED.total_fee_minor, line_count = EXCLUDED.line_count,
                 currency = EXCLUDED.currency, source_published_at = EXCLUDED.source_published_at,
                 freshness = 'fresh', refreshed_at = now()
           RETURNING ${AGG_COLS}`,
          [this.config.bankId, a.channel, a.period, a.line_type, a.total_fee_minor, a.line_count, a.currency, a.source_published_at]
        )
        out.push(res.rows[0])
      }
      return out
    })
    await this.emit('nebras_report_aggregate', AGG_LINEAGE, traceId)
    return rows.map(toAggregate)
  }

  /** Mark a period's aggregates stale (amber) — last-good retained on a failed poll. */
  async markStale(period: string, traceId: string): Promise<number> {
    const count = await this.asApp(async (c) => (await c.query(`UPDATE nebras_report_aggregate SET freshness = 'stale' WHERE period = $1`, [period])).rowCount ?? 0)
    if (count > 0) await this.emit('nebras_report_aggregate', AGG_LINEAGE, traceId)
    return count
  }

  async listForPeriod(period: string): Promise<StoredAggregate[]> {
    const rows = await this.asApp(async (c) =>
      (await c.query(`SELECT ${AGG_COLS} FROM nebras_report_aggregate WHERE period = $1 ORDER BY channel, line_type`, [period])).rows
    )
    return rows.map(toAggregate)
  }
}
