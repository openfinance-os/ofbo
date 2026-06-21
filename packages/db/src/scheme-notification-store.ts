import pg from 'pg'
import { beginAppTx } from './tenant-tx.js'
import type { LineageSink } from './lineage.js'

/**
 * BACKOFFICE-78 — scheme_notification persistence (outbound downtime/change notices
 * to Nebras). Writes run as ofbo_app with the tenancy context set (RLS binds).
 * scheme_notification is a mutable workflow table (notified -> acknowledged).
 * Column-level BCBS 239 lineage at write time.
 */

export interface StoredSchemeNotification {
  id: string
  notification_type: string
  title: string
  description: string | null
  scheduled_start: string
  scheduled_end: string
  notice_required_days: number
  notified_at: string | null
  notice_deadline: string
  notice_compliant: boolean
  dual_running_required: boolean
  dual_running_complete: boolean
  acknowledged: boolean
  acknowledged_at: string | null
  nebras_ack_reference: string | null
  propagate_to_tpp: boolean
  status: string
  created_by: string
  created_at: string
}

export interface SchemeNotificationCreateInput {
  notification_type: string
  title: string
  description?: string | null
  scheduled_start: string
  scheduled_end: string
  notice_required_days: number
  notified_at: string | null
  notice_deadline: string
  notice_compliant: boolean
  dual_running_required: boolean
  propagate_to_tpp: boolean
  status: string
  created_by: string
}

export interface SchemeNotificationUpdate {
  status?: string
  acknowledged?: boolean
  acknowledged_at?: string | null
  nebras_ack_reference?: string | null
  dual_running_complete?: boolean
}

export interface SchemeNotificationListQuery {
  cursor?: string
  limit?: number
  status?: string
  notification_type?: string
}

export interface SchemeNotificationPage {
  rows: StoredSchemeNotification[]
  next_cursor: string | null
}

const SELECT_COLUMNS = `id, notification_type, title, description, scheduled_start, scheduled_end,
  notice_required_days, notified_at, notice_deadline, notice_compliant, dual_running_required,
  dual_running_complete, acknowledged, acknowledged_at, nebras_ack_reference, propagate_to_tpp,
  status, created_by, created_at`

const LINEAGE_COLUMNS = [
  'bank_id', 'channel', 'notification_type', 'title', 'scheduled_start', 'scheduled_end',
  'notice_required_days', 'notice_deadline', 'notice_compliant', 'status', 'propagate_to_tpp'
]

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v))
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v))

function toRecord(r: Record<string, unknown>): StoredSchemeNotification {
  return {
    id: r.id as string,
    notification_type: r.notification_type as string,
    title: r.title as string,
    description: (r.description as string) ?? null,
    scheduled_start: iso(r.scheduled_start),
    scheduled_end: iso(r.scheduled_end),
    notice_required_days: Number(r.notice_required_days),
    notified_at: isoOrNull(r.notified_at),
    notice_deadline: iso(r.notice_deadline),
    notice_compliant: Boolean(r.notice_compliant),
    dual_running_required: Boolean(r.dual_running_required),
    dual_running_complete: Boolean(r.dual_running_complete),
    acknowledged: Boolean(r.acknowledged),
    acknowledged_at: isoOrNull(r.acknowledged_at),
    nebras_ack_reference: (r.nebras_ack_reference as string) ?? null,
    propagate_to_tpp: Boolean(r.propagate_to_tpp),
    status: r.status as string,
    created_by: r.created_by as string,
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

export class PgSchemeNotificationStore {
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
      await c.query(beginAppTx(this.config.bankId))
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
        table: 'scheme_notification',
        columns: LINEAGE_COLUMNS,
        source: 'bff-scheme-notification-store',
        trace_id: traceId
      })
    } catch {
      /* catalogue unavailable — the regulated write stands; Q4.5 surfaces persistent gaps */
    }
  }

  async create(input: SchemeNotificationCreateInput, traceId: string): Promise<StoredSchemeNotification> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `INSERT INTO scheme_notification
           (bank_id, channel, notification_type, title, description, scheduled_start, scheduled_end,
            notice_required_days, notified_at, notice_deadline, notice_compliant, dual_running_required,
            propagate_to_tpp, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING ${SELECT_COLUMNS}`,
        [
          this.config.bankId,
          this.config.channel,
          input.notification_type,
          input.title,
          input.description ?? null,
          input.scheduled_start,
          input.scheduled_end,
          input.notice_required_days,
          input.notified_at ?? null,
          input.notice_deadline,
          input.notice_compliant,
          input.dual_running_required,
          input.propagate_to_tpp,
          input.status,
          input.created_by
        ]
      )
      return res.rows[0]
    })
    await this.emitLineage(traceId)
    return toRecord(row)
  }

  async get(id: string): Promise<StoredSchemeNotification | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(`SELECT ${SELECT_COLUMNS} FROM scheme_notification WHERE id = $1`, [id])
      return res.rows[0] ?? null
    })
    return row ? toRecord(row) : null
  }

  /** Record Nebras acknowledgment / dual-running completion. scheme_notification is a
   *  mutable workflow table (RLS UPDATE). */
  async update(id: string, patch: SchemeNotificationUpdate, traceId: string): Promise<StoredSchemeNotification | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `UPDATE scheme_notification
            SET status                = COALESCE($2, status),
                acknowledged          = COALESCE($3, acknowledged),
                acknowledged_at       = COALESCE($4, acknowledged_at),
                nebras_ack_reference  = COALESCE($5, nebras_ack_reference),
                dual_running_complete = COALESCE($6, dual_running_complete)
          WHERE id = $1
          RETURNING ${SELECT_COLUMNS}`,
        [
          id,
          patch.status ?? null,
          patch.acknowledged ?? null,
          patch.acknowledged_at ?? null,
          patch.nebras_ack_reference ?? null,
          patch.dual_running_complete ?? null
        ]
      )
      return res.rows[0] ?? null
    })
    if (row) await this.emitLineage(traceId)
    return row ? toRecord(row) : null
  }

  async list(query: SchemeNotificationListQuery = {}): Promise<SchemeNotificationPage> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const after = query.cursor ? decodeCursor(query.cursor) : null
    const rows = await this.asApp(async (c) => {
      const params: unknown[] = []
      const where: string[] = []
      if (query.status) {
        params.push(query.status)
        where.push(`status = $${params.length}`)
      }
      if (query.notification_type) {
        params.push(query.notification_type)
        where.push(`notification_type = $${params.length}`)
      }
      if (after) {
        params.push(after.createdAt, after.id)
        where.push(`(date_trunc('milliseconds', created_at), id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`)
      }
      const res = await c.query(
        `SELECT ${SELECT_COLUMNS} FROM scheme_notification
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
