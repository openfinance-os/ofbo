import pg from 'pg'
import { beginAppTx } from './tenant-tx.js'
import type { LineageSink } from './lineage.js'

/**
 * BACKOFFICE-75 — respondent_dispute persistence. The bank is the RESPONDENT in a
 * Nebras-raised dispute, bound to scheme clocks. Writes run as ofbo_app with the
 * tenancy context set (RLS binds). The store persists the raw clock timestamps the
 * service computes (business-day math); the derived amber/red statuses are computed
 * at read time by the service. Column-level BCBS 239 lineage at write time.
 */

export interface StoredRespondentDispute {
  id: string
  nebras_dispute_ref: string
  category: string
  subject_summary: string | null
  raised_at: string
  originating_break_id: string | null
  state: string
  response_due_at: string
  responded_at: string | null
  resolution_due_at: string
  resolved_at: string | null
  appeal_due_at: string | null
  appealed_at: string | null
  implementation_due_at: string | null
  implemented_at: string | null
  verdict_outcome: string | null
  created_at: string
}

export interface RespondentDisputeCreateInput {
  nebras_dispute_ref: string
  category: string
  subject_summary?: string | null
  raised_at: string
  originating_break_id?: string | null
  response_due_at: string
  resolution_due_at: string
}

/** Partial clock/state patch applied by an :advance action. */
export interface RespondentDisputeUpdate {
  state?: string
  responded_at?: string | null
  resolved_at?: string | null
  appeal_due_at?: string | null
  appealed_at?: string | null
  implementation_due_at?: string | null
  implemented_at?: string | null
  verdict_outcome?: string | null
}

export interface RespondentDisputeListQuery {
  cursor?: string
  limit?: number
  state?: string
}

export interface RespondentDisputePage {
  rows: StoredRespondentDispute[]
  next_cursor: string | null
}

const SELECT_COLUMNS = `id, nebras_dispute_ref, category, subject_summary, raised_at,
  originating_break_id, state, response_due_at, responded_at, resolution_due_at, resolved_at,
  appeal_due_at, appealed_at, implementation_due_at, implemented_at, verdict_outcome, created_at`

const LINEAGE_COLUMNS = [
  'bank_id', 'channel', 'nebras_dispute_ref', 'category', 'state',
  'raised_at', 'response_due_at', 'resolution_due_at', 'verdict_outcome', 'originating_break_id'
]

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v))
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v))

function toRecord(r: Record<string, unknown>): StoredRespondentDispute {
  return {
    id: r.id as string,
    nebras_dispute_ref: r.nebras_dispute_ref as string,
    category: r.category as string,
    subject_summary: (r.subject_summary as string) ?? null,
    raised_at: iso(r.raised_at),
    originating_break_id: (r.originating_break_id as string) ?? null,
    state: r.state as string,
    response_due_at: iso(r.response_due_at),
    responded_at: isoOrNull(r.responded_at),
    resolution_due_at: iso(r.resolution_due_at),
    resolved_at: isoOrNull(r.resolved_at),
    appeal_due_at: isoOrNull(r.appeal_due_at),
    appealed_at: isoOrNull(r.appealed_at),
    implementation_due_at: isoOrNull(r.implementation_due_at),
    implemented_at: isoOrNull(r.implemented_at),
    verdict_outcome: (r.verdict_outcome as string) ?? null,
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

export class PgRespondentDisputeStore {
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
        table: 'respondent_dispute',
        columns: LINEAGE_COLUMNS,
        source: 'bff-respondent-dispute-store',
        trace_id: traceId
      })
    } catch {
      /* catalogue unavailable — the regulated write stands; Q4.5 surfaces persistent gaps */
    }
  }

  async create(input: RespondentDisputeCreateInput, traceId: string): Promise<StoredRespondentDispute> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `INSERT INTO respondent_dispute
           (bank_id, channel, nebras_dispute_ref, category, subject_summary, raised_at,
            originating_break_id, response_due_at, resolution_due_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING ${SELECT_COLUMNS}`,
        [
          this.config.bankId,
          this.config.channel,
          input.nebras_dispute_ref,
          input.category,
          input.subject_summary ?? null,
          input.raised_at,
          input.originating_break_id ?? null,
          input.response_due_at,
          input.resolution_due_at
        ]
      )
      return res.rows[0]
    })
    await this.emitLineage(traceId)
    return toRecord(row)
  }

  async get(id: string): Promise<StoredRespondentDispute | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(`SELECT ${SELECT_COLUMNS} FROM respondent_dispute WHERE id = $1`, [id])
      return res.rows[0] ?? null
    })
    return row ? toRecord(row) : null
  }

  /** Apply an :advance patch (clock stop / start). respondent_dispute is a mutable
   *  workflow table (RLS UPDATE). COALESCE keeps unspecified columns untouched. */
  async update(id: string, patch: RespondentDisputeUpdate, traceId: string): Promise<StoredRespondentDispute | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `UPDATE respondent_dispute
            SET state                 = COALESCE($2, state),
                responded_at          = COALESCE($3, responded_at),
                resolved_at           = COALESCE($4, resolved_at),
                appeal_due_at         = COALESCE($5, appeal_due_at),
                appealed_at           = COALESCE($6, appealed_at),
                implementation_due_at = COALESCE($7, implementation_due_at),
                implemented_at        = COALESCE($8, implemented_at),
                verdict_outcome       = COALESCE($9, verdict_outcome)
          WHERE id = $1
          RETURNING ${SELECT_COLUMNS}`,
        [
          id,
          patch.state ?? null,
          patch.responded_at ?? null,
          patch.resolved_at ?? null,
          patch.appeal_due_at ?? null,
          patch.appealed_at ?? null,
          patch.implementation_due_at ?? null,
          patch.implemented_at ?? null,
          patch.verdict_outcome ?? null
        ]
      )
      return res.rows[0] ?? null
    })
    if (row) await this.emitLineage(traceId)
    return row ? toRecord(row) : null
  }

  async list(query: RespondentDisputeListQuery = {}): Promise<RespondentDisputePage> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const after = query.cursor ? decodeCursor(query.cursor) : null
    const rows = await this.asApp(async (c) => {
      const params: unknown[] = []
      const where: string[] = []
      if (query.state) {
        params.push(query.state)
        where.push(`state = $${params.length}`)
      }
      if (after) {
        params.push(after.createdAt, after.id)
        where.push(`(date_trunc('milliseconds', created_at), id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`)
      }
      const res = await c.query(
        `SELECT ${SELECT_COLUMNS} FROM respondent_dispute
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY date_trunc('milliseconds', created_at), id
         LIMIT ${limit + 1}`,
        params
      )
      return res.rows
    })
    const hasMore = rows.length > limit
    const page = (hasMore ? rows.slice(0, limit) : rows).map(toRecord)
    const last = page[page.length - 1]
    return { rows: page, next_cursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
