import pg from 'pg'
import type { LineageSink } from './lineage.js'

/**
 * BACKOFFICE-02 — reconciliation_break persistence. Writes run as ofbo_app with
 * the tenancy context set (RLS binds). This store creates breaks (detection) and
 * lists them; the lifecycle UPDATE path (claim/resolve/escalate/reopen) lands
 * with BACKOFFICE-03/-04/-05. Column-level BCBS 239 lineage at write time.
 */

export interface Money {
  amount: number
  currency: string
}

export interface StoredReconciliationBreak {
  id: string
  run_id: string
  client_id: string | null
  channel: string
  line_type: string
  status: string
  variance_amount: Money | null
  variance_count: number | null
  source_a_ref: string
  source_b_ref: string
  source_c_ref: string | null
  assigned_to: string | null
  sla_clock_started_at: string | null
  resolution_outcome: string | null
  resolution_note: string | null
  nebras_dispute_case_id: string | null
  reopened_count: number
  created_at: string
}

export interface ReconciliationBreakCreateInput {
  run_id: string
  client_id?: string | null
  line_type: string
  variance_amount?: Money | null
  variance_count?: number | null
  source_a_ref: string
  source_b_ref: string
  source_c_ref?: string | null
}

export interface ReconciliationBreakListQuery {
  cursor?: string
  limit?: number
  run_id?: string
  status?: string
  line_type?: string
  client_id?: string
}

export interface ReconciliationBreakPage {
  rows: StoredReconciliationBreak[]
  next_cursor: string | null
}

const SELECT_COLUMNS = `id, run_id, client_id, channel, line_type, status,
  variance_amount, variance_currency, variance_count, source_a_ref, source_b_ref, source_c_ref,
  assigned_to, sla_clock_started_at, resolution_outcome, resolution_note,
  nebras_dispute_case_id, reopened_count, created_at`

const LINEAGE_COLUMNS = [
  'bank_id', 'channel', 'run_id', 'client_id', 'line_type', 'status',
  'variance_amount', 'variance_count', 'source_a_ref', 'source_b_ref', 'source_c_ref', 'sla_clock_started_at'
]

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v))

function toBreak(r: Record<string, unknown>): StoredReconciliationBreak {
  return {
    id: r.id as string,
    run_id: r.run_id as string,
    client_id: (r.client_id as string) ?? null,
    channel: r.channel as string,
    line_type: r.line_type as string,
    status: r.status as string,
    variance_amount:
      r.variance_amount !== null && r.variance_amount !== undefined
        ? { amount: Number(r.variance_amount), currency: r.variance_currency as string }
        : null,
    variance_count: r.variance_count === null || r.variance_count === undefined ? null : Number(r.variance_count),
    source_a_ref: r.source_a_ref as string,
    source_b_ref: r.source_b_ref as string,
    source_c_ref: (r.source_c_ref as string) ?? null,
    assigned_to: (r.assigned_to as string) ?? null,
    sla_clock_started_at: r.sla_clock_started_at ? iso(r.sla_clock_started_at) : null,
    resolution_outcome: (r.resolution_outcome as string) ?? null,
    resolution_note: (r.resolution_note as string) ?? null,
    nebras_dispute_case_id: (r.nebras_dispute_case_id as string) ?? null,
    reopened_count: Number(r.reopened_count ?? 0),
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

export class PgReconciliationBreakStore {
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
        table: 'reconciliation_break',
        columns: LINEAGE_COLUMNS,
        source: 'reconciliation-engine',
        trace_id: traceId
      })
    } catch {
      /* catalogue unavailable — the regulated write stands; Q4.5 surfaces persistent gaps */
    }
  }

  /** Persist a batch of detected breaks for a run. sla_clock starts at insertion. */
  async createMany(inputs: ReconciliationBreakCreateInput[], traceId: string): Promise<StoredReconciliationBreak[]> {
    if (inputs.length === 0) return []
    const rows = await this.asApp(async (c) => {
      const out: Record<string, unknown>[] = []
      for (const input of inputs) {
        const res = await c.query(
          `INSERT INTO reconciliation_break
             (bank_id, channel, run_id, client_id, line_type, status,
              variance_amount, variance_currency, variance_count,
              source_a_ref, source_b_ref, source_c_ref, sla_clock_started_at)
           VALUES ($1,$2,$3,$4,$5,'flagged',$6,$7,$8,$9,$10,$11, now())
           RETURNING ${SELECT_COLUMNS}`,
          [
            this.config.bankId,
            this.config.channel,
            input.run_id,
            input.client_id ?? null,
            input.line_type,
            input.variance_amount?.amount ?? null,
            input.variance_amount?.currency ?? null,
            input.variance_count ?? null,
            input.source_a_ref,
            input.source_b_ref,
            input.source_c_ref ?? null
          ]
        )
        out.push(res.rows[0])
      }
      return out
    })
    await this.emitLineage(traceId)
    return rows.map(toBreak)
  }

  async get(id: string): Promise<StoredReconciliationBreak | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(`SELECT ${SELECT_COLUMNS} FROM reconciliation_break WHERE id = $1`, [id])
      return res.rows[0] ?? null
    })
    return row ? toBreak(row) : null
  }

  /**
   * BACKOFFICE-03 — claim a FLAGGED break: → assigned, record the claimant, and
   * start the resolution SLA clock. The `status = 'flagged'` guard makes the
   * claim atomic — a concurrent second claim updates 0 rows (returns null), so
   * the break leaves every other claimant's queue. reconciliation_break is a
   * mutable workflow table (RLS UPDATE).
   */
  async claim(id: string, assignedTo: string, traceId: string): Promise<StoredReconciliationBreak | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `UPDATE reconciliation_break
            SET status = 'assigned', assigned_to = $2, sla_clock_started_at = now()
          WHERE id = $1 AND status = 'flagged'
          RETURNING ${SELECT_COLUMNS}`,
        [id, assignedTo]
      )
      return res.rows[0] ?? null
    })
    if (row) await this.emitLineage(traceId)
    return row ? toBreak(row) : null
  }

  /** Count breaks already recorded for a run — used to keep detection idempotent. */
  async countForRun(runId: string): Promise<number> {
    return this.asApp(async (c) => {
      const res = await c.query(`SELECT count(*)::int AS n FROM reconciliation_break WHERE run_id = $1`, [runId])
      return Number(res.rows[0].n)
    })
  }

  async list(query: ReconciliationBreakListQuery = {}): Promise<ReconciliationBreakPage> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const after = query.cursor ? decodeCursor(query.cursor) : null
    const rows = await this.asApp(async (c) => {
      const params: unknown[] = []
      const where: string[] = []
      for (const [col, val] of [
        ['run_id', query.run_id],
        ['status', query.status],
        ['line_type', query.line_type],
        ['client_id', query.client_id]
      ] as const) {
        if (val) {
          params.push(val)
          where.push(`${col} = $${params.length}${col === 'client_id' ? '::uuid' : ''}`)
        }
      }
      if (after) {
        params.push(after.createdAt, after.id)
        where.push(`(date_trunc('milliseconds', created_at), id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`)
      }
      const res = await c.query(
        `SELECT ${SELECT_COLUMNS} FROM reconciliation_break
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY date_trunc('milliseconds', created_at) DESC, id DESC
         LIMIT ${limit + 1}`,
        params
      )
      return res.rows
    })
    const hasMore = rows.length > limit
    const page = (hasMore ? rows.slice(0, limit) : rows).map(toBreak)
    const last = page[page.length - 1]
    return { rows: page, next_cursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
