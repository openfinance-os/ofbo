import pg from 'pg'
import type { LineageSink } from './lineage.js'

/**
 * BACKOFFICE-79 — service_desk_case persistence (Nebras service-desk cases). Writes run
 * as ofbo_app with the tenancy context set (RLS binds); it is a mutable workflow table
 * (open → resolved/closed). Column-level BCBS 239 lineage at write time.
 */

export interface StoredServiceDeskCase {
  id: string
  nebras_case_reference: string
  case_type: string
  priority: string
  status: string
  summary: string
  sla_due_at: string
  linked_break_id: string | null
  linked_dispute_id: string | null
  linked_signal_id: string | null
  opened_by: string
  opened_at: string
  resolved_at: string | null
  created_at: string
}

export interface ServiceDeskCaseCreateInput {
  nebras_case_reference: string
  case_type: string
  priority: string
  status: string
  summary: string
  sla_due_at: string
  linked_break_id?: string | null
  linked_dispute_id?: string | null
  linked_signal_id?: string | null
  opened_by: string
}

export interface ServiceDeskCaseUpdate {
  status?: string
  priority?: string
  resolved_at?: string | null
}

export interface ServiceDeskCaseListQuery {
  cursor?: string
  limit?: number
  case_type?: string
  priority?: string
  status?: string
}

export interface ServiceDeskCasePage {
  rows: StoredServiceDeskCase[]
  next_cursor: string | null
}

const SELECT_COLUMNS = `id, nebras_case_reference, case_type, priority, status, summary, sla_due_at,
  linked_break_id, linked_dispute_id, linked_signal_id, opened_by, opened_at, resolved_at, created_at`

const LINEAGE_COLUMNS = [
  'bank_id', 'channel', 'nebras_case_reference', 'case_type', 'priority', 'status',
  'sla_due_at', 'linked_break_id', 'linked_dispute_id', 'linked_signal_id'
]

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v))
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v))

function toRecord(r: Record<string, unknown>): StoredServiceDeskCase {
  return {
    id: r.id as string,
    nebras_case_reference: r.nebras_case_reference as string,
    case_type: r.case_type as string,
    priority: r.priority as string,
    status: r.status as string,
    summary: r.summary as string,
    sla_due_at: iso(r.sla_due_at),
    linked_break_id: (r.linked_break_id as string) ?? null,
    linked_dispute_id: (r.linked_dispute_id as string) ?? null,
    linked_signal_id: (r.linked_signal_id as string) ?? null,
    opened_by: r.opened_by as string,
    opened_at: iso(r.opened_at),
    resolved_at: isoOrNull(r.resolved_at),
    created_at: iso(r.created_at)
  }
}

const encodeCursor = (createdAt: string, id: string) =>
  Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url')
function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
    return createdAt && id ? { createdAt, id } : null
  } catch {
    return null
  }
}

export class PgServiceDeskCaseStore {
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
        table: 'service_desk_case',
        columns: LINEAGE_COLUMNS,
        source: 'bff-service-desk-store',
        trace_id: traceId
      })
    } catch {
      /* catalogue unavailable — the regulated write stands; Q4.5 surfaces persistent gaps */
    }
  }

  async create(input: ServiceDeskCaseCreateInput, traceId: string): Promise<StoredServiceDeskCase> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `INSERT INTO service_desk_case
           (bank_id, channel, nebras_case_reference, case_type, priority, status, summary, sla_due_at,
            linked_break_id, linked_dispute_id, linked_signal_id, opened_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING ${SELECT_COLUMNS}`,
        [
          this.config.bankId,
          this.config.channel,
          input.nebras_case_reference,
          input.case_type,
          input.priority,
          input.status,
          input.summary,
          input.sla_due_at,
          input.linked_break_id ?? null,
          input.linked_dispute_id ?? null,
          input.linked_signal_id ?? null,
          input.opened_by
        ]
      )
      return res.rows[0]
    })
    await this.emitLineage(traceId)
    return toRecord(row)
  }

  async get(id: string): Promise<StoredServiceDeskCase | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(`SELECT ${SELECT_COLUMNS} FROM service_desk_case WHERE id = $1`, [id])
      return res.rows[0] ?? null
    })
    return row ? toRecord(row) : null
  }

  /** status/priority/resolution update. Mutable workflow table (RLS UPDATE). */
  async update(id: string, patch: ServiceDeskCaseUpdate, traceId: string): Promise<StoredServiceDeskCase | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `UPDATE service_desk_case
            SET status      = COALESCE($2, status),
                priority    = COALESCE($3, priority),
                resolved_at = COALESCE($4, resolved_at)
          WHERE id = $1
          RETURNING ${SELECT_COLUMNS}`,
        [id, patch.status ?? null, patch.priority ?? null, patch.resolved_at ?? null]
      )
      return res.rows[0] ?? null
    })
    if (row) await this.emitLineage(traceId)
    return row ? toRecord(row) : null
  }

  async list(query: ServiceDeskCaseListQuery = {}): Promise<ServiceDeskCasePage> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const after = query.cursor ? decodeCursor(query.cursor) : null
    const rows = await this.asApp(async (c) => {
      const params: unknown[] = []
      const where: string[] = []
      if (query.case_type) {
        params.push(query.case_type)
        where.push(`case_type = $${params.length}`)
      }
      if (query.priority) {
        params.push(query.priority)
        where.push(`priority = $${params.length}`)
      }
      if (query.status) {
        params.push(query.status)
        where.push(`status = $${params.length}`)
      }
      if (after) {
        params.push(after.createdAt, after.id)
        where.push(`(date_trunc('milliseconds', created_at), id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`)
      }
      const res = await c.query(
        `SELECT ${SELECT_COLUMNS} FROM service_desk_case
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY date_trunc('milliseconds', created_at), id
         LIMIT ${limit + 1}`,
        params
      )
      return res.rows
    })
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const last = page[page.length - 1] as Record<string, unknown> | undefined
    return {
      rows: page.map(toRecord),
      next_cursor: hasMore && last ? encodeCursor(iso(last.created_at), last.id as string) : null
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
