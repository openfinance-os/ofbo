import pg from 'pg'
import { beginAppTx } from './tenant-tx.js'
import type { LineageSink } from './lineage.js'

/**
 * BACKOFFICE-63 — str_draft persistence (STR drafts held for Compliance handoff to the bank's
 * STR workflow, P10). Writes run as ofbo_app with the tenancy context set (RLS binds); it is a
 * mutable workflow table (draft → awaiting_handoff → handed_off). Column-level BCBS 239 lineage
 * at write time. No PSU PII — an internal consent ref + case context only.
 *
 * Method shapes mirror the BFF StrDraftStore interface structurally (str/service.ts), so this
 * store is a drop-in durable replacement for InMemoryStrDraftStore — packages/db never imports
 * from services/bff.
 */

type StrDraftStatus = 'draft' | 'awaiting_handoff' | 'handed_off'

export interface StoredStrDraft {
  str_draft_id: string
  source_consent_id: string
  case_context: string
  status: StrDraftStatus
  created_by: string
  approval_id: string | null
  workflow_ref: string | null
  approved_by: string | null
  handed_off_at: string | null
  created_at: string
}

export interface StrDraftRecordInput {
  source_consent_id: string
  case_context: string
  created_by: string
}

export interface StrDraftStatusPatch {
  approval_id?: string | null
  workflow_ref?: string | null
  approved_by?: string | null
  handed_off_at?: string | null
}

export interface StrDraftListQuery {
  cursor?: string
  limit?: number
  status?: string
}

export interface StrDraftPage {
  rows: StoredStrDraft[]
  next_cursor: string | null
}

const SELECT_COLUMNS = `id AS str_draft_id, source_consent_id, case_context, status, created_by,
  approval_id, workflow_ref, approved_by, handed_off_at, created_at`

const LINEAGE_COLUMNS = [
  'bank_id', 'channel', 'source_consent_id', 'case_context', 'status', 'created_by',
  'approval_id', 'workflow_ref', 'approved_by', 'handed_off_at'
]

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v))
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v))
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

function toRecord(r: Record<string, unknown>): StoredStrDraft {
  return {
    str_draft_id: r.str_draft_id as string,
    source_consent_id: r.source_consent_id as string,
    case_context: r.case_context as string,
    status: r.status as StrDraftStatus,
    created_by: r.created_by as string,
    approval_id: strOrNull(r.approval_id),
    workflow_ref: strOrNull(r.workflow_ref),
    approved_by: strOrNull(r.approved_by),
    handed_off_at: isoOrNull(r.handed_off_at),
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

export class PgStrDraftStore {
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
        table: 'str_draft',
        columns: LINEAGE_COLUMNS,
        source: 'bff-str-draft-store',
        trace_id: traceId
      })
    } catch {
      /* catalogue unavailable — the regulated write stands; Q4.5 surfaces persistent gaps */
    }
  }

  async record(input: StrDraftRecordInput, traceId: string): Promise<StoredStrDraft> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `INSERT INTO str_draft (bank_id, channel, source_consent_id, case_context, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${SELECT_COLUMNS}`,
        [this.config.bankId, this.config.channel, input.source_consent_id, input.case_context, input.created_by]
      )
      return res.rows[0]
    })
    await this.emitLineage(traceId)
    return toRecord(row)
  }

  async get(id: string): Promise<StoredStrDraft | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(`SELECT ${SELECT_COLUMNS} FROM str_draft WHERE id = $1`, [id])
      return res.rows[0] ?? null
    })
    return row ? toRecord(row) : null
  }

  /** Advance status + stamp the handoff/approval fields. Mutable workflow table (RLS UPDATE). */
  async markStatus(id: string, status: StrDraftStatus, patch: StrDraftStatusPatch, traceId = 'unknown'): Promise<StoredStrDraft | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `UPDATE str_draft
            SET status        = $2,
                approval_id   = COALESCE($3, approval_id),
                workflow_ref  = COALESCE($4, workflow_ref),
                approved_by   = COALESCE($5, approved_by),
                handed_off_at = COALESCE($6, handed_off_at)
          WHERE id = $1
          RETURNING ${SELECT_COLUMNS}`,
        [id, status, patch.approval_id ?? null, patch.workflow_ref ?? null, patch.approved_by ?? null, patch.handed_off_at ?? null]
      )
      return res.rows[0] ?? null
    })
    if (row) await this.emitLineage(traceId)
    return row ? toRecord(row) : null
  }

  async list(query: StrDraftListQuery = {}): Promise<StrDraftPage> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const after = query.cursor ? decodeCursor(query.cursor) : null
    const rows = await this.asApp(async (c) => {
      const params: unknown[] = []
      const where: string[] = []
      if (query.status) {
        params.push(query.status)
        where.push(`status = $${params.length}`)
      }
      if (after) {
        params.push(after.createdAt, after.id)
        where.push(`(date_trunc('milliseconds', created_at), id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`)
      }
      const res = await c.query(
        `SELECT ${SELECT_COLUMNS} FROM str_draft
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
      next_cursor: hasMore && last ? encodeCursor(iso(last.created_at), last.str_draft_id as string) : null
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
