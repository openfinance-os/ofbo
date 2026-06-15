import pg from 'pg'
import type { LineageSink } from './lineage.js'

/**
 * BACKOFFICE-01 — reconciliation_log persistence. Writes run as ofbo_app with
 * the tenancy context set (RLS binds). reconciliation_log is append-only in
 * practice (a run is written once on completion); run_id is UNIQUE so a re-run
 * of the same window is idempotent (ON CONFLICT returns the original row).
 * Column-level BCBS 239 lineage at write time (Q4.5).
 */

export interface StoredReconciliationRun {
  id: string
  run_id: string
  run_type: string
  status: string
  window_start: string
  window_end: string
  line_count_total: number | null
  line_count_matched: number | null
  line_count_unmatched: number | null
  line_count_disputed: number | null
  failure_reason: string | null
  created_at: string
}

export interface ReconciliationRunCreateInput {
  run_id: string
  run_type: string
  status: string
  window_start: string
  window_end: string
  line_count_total?: number | null
  line_count_matched?: number | null
  line_count_unmatched?: number | null
  line_count_disputed?: number | null
  failure_reason?: string | null
}

export interface ReconciliationRunListQuery {
  cursor?: string
  limit?: number
  run_type?: string
  status?: string
}

export interface ReconciliationRunPage {
  rows: StoredReconciliationRun[]
  next_cursor: string | null
}

const SELECT_COLUMNS = `id, run_id, run_type, status, window_start, window_end,
  line_count_total, line_count_matched, line_count_unmatched, line_count_disputed,
  failure_reason, created_at`

const LINEAGE_COLUMNS = [
  'bank_id', 'channel', 'run_id', 'run_type', 'status', 'window_start', 'window_end',
  'line_count_total', 'line_count_matched', 'line_count_unmatched', 'line_count_disputed'
]

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v))
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

function toRun(r: Record<string, unknown>): StoredReconciliationRun {
  return {
    id: r.id as string,
    run_id: r.run_id as string,
    run_type: r.run_type as string,
    status: r.status as string,
    window_start: iso(r.window_start),
    window_end: iso(r.window_end),
    line_count_total: num(r.line_count_total),
    line_count_matched: num(r.line_count_matched),
    line_count_unmatched: num(r.line_count_unmatched),
    line_count_disputed: num(r.line_count_disputed),
    failure_reason: (r.failure_reason as string) ?? null,
    created_at: iso(r.created_at)
  }
}

const encodeCursor = (createdAt: string, id: string) => Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url')
function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
    return createdAt && id ? { createdAt, id } : null
  } catch {
    return null
  }
}

export class PgReconciliationLogStore {
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

  private async emitLineage(traceId: string): Promise<void> {
    try {
      await this.lineage?.emitLineage({
        table: 'reconciliation_log',
        columns: LINEAGE_COLUMNS,
        source: 'reconciliation-engine',
        trace_id: traceId
      })
    } catch {
      /* catalogue unavailable — the regulated write stands; Q4.5 surfaces persistent gaps */
    }
  }

  /** Idempotent on run_id: re-running the same window returns the original row
   *  and does NOT write a second log (resumable scheduled-job requirement). */
  async create(input: ReconciliationRunCreateInput, traceId: string): Promise<{ run: StoredReconciliationRun; created: boolean }> {
    const result = await this.asApp(async (c) => {
      const ins = await c.query(
        `INSERT INTO reconciliation_log
           (bank_id, channel, run_id, run_type, status, window_start, window_end,
            line_count_total, line_count_matched, line_count_unmatched, line_count_disputed, failure_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (run_id) DO NOTHING
         RETURNING ${SELECT_COLUMNS}`,
        [
          this.config.bankId,
          this.config.channel,
          input.run_id,
          input.run_type,
          input.status,
          input.window_start,
          input.window_end,
          input.line_count_total ?? null,
          input.line_count_matched ?? null,
          input.line_count_unmatched ?? null,
          input.line_count_disputed ?? null,
          input.failure_reason ?? null
        ]
      )
      if (ins.rows[0]) return { row: ins.rows[0], created: true }
      const existing = await c.query(`SELECT ${SELECT_COLUMNS} FROM reconciliation_log WHERE run_id = $1`, [input.run_id])
      return { row: existing.rows[0], created: false }
    })
    if (result.created) await this.emitLineage(traceId)
    return { run: toRun(result.row), created: result.created }
  }

  /** BACKOFFICE-06 — count runs whose run_id matches a prefix (a month). */
  async countForPrefix(runIdPrefix: string): Promise<number> {
    return this.asApp(async (c) => {
      const res = await c.query(`SELECT count(*)::int AS n FROM reconciliation_log WHERE run_id LIKE $1`, [`${runIdPrefix}%`])
      return Number(res.rows[0].n)
    })
  }

  async get(runId: string): Promise<StoredReconciliationRun | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(`SELECT ${SELECT_COLUMNS} FROM reconciliation_log WHERE run_id = $1`, [runId])
      return res.rows[0] ?? null
    })
    return row ? toRun(row) : null
  }

  async list(query: ReconciliationRunListQuery = {}): Promise<ReconciliationRunPage> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const after = query.cursor ? decodeCursor(query.cursor) : null
    const rows = await this.asApp(async (c) => {
      const params: unknown[] = []
      const where: string[] = []
      if (query.run_type) {
        params.push(query.run_type)
        where.push(`run_type = $${params.length}`)
      }
      if (query.status) {
        params.push(query.status)
        where.push(`status = $${params.length}`)
      }
      if (after) {
        params.push(after.createdAt, after.id)
        where.push(`(date_trunc('milliseconds', created_at), id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`)
      }
      const res = await c.query(
        `SELECT ${SELECT_COLUMNS} FROM reconciliation_log
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY date_trunc('milliseconds', created_at) DESC, id DESC
         LIMIT ${limit + 1}`,
        params
      )
      return res.rows
    })
    const hasMore = rows.length > limit
    const page = (hasMore ? rows.slice(0, limit) : rows).map(toRun)
    const last = page[page.length - 1]
    return { rows: page, next_cursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
