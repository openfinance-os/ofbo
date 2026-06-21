import pg from 'pg'
import { beginAppTx } from './tenant-tx.js'
import type { LineageSink } from './lineage.js'

/**
 * BACKOFFICE-74 — trust_framework_participant persistence. The bank's own directory
 * role-holders (Org Admin / PBC / PTC / STC). Writes run as ofbo_app with the tenancy
 * context set (RLS binds); it is a mutable workflow table (turnover updates in place).
 * Column-level BCBS 239 lineage at write time.
 */

export interface StoredTrustFrameworkParticipant {
  id: string
  role: string
  organisation_id: string
  holder_ref: string
  holder_display_name: string
  onboarding_stage: string | null
  individual_tnc_status: string
  organisational_tnc_status: string
  onboarding_stage_due_at: string | null
  status: string
  nominated_replacement_ref: string | null
  created_at: string
  updated_at: string
}

export interface TrustFrameworkParticipantCreateInput {
  role: string
  organisation_id: string
  holder_ref: string
  holder_display_name: string
  onboarding_stage?: string | null
  onboarding_stage_due_at?: string | null
}

export interface TrustFrameworkParticipantUpdate {
  status?: string
  nominated_replacement_ref?: string | null
  individual_tnc_status?: string
  organisational_tnc_status?: string
  onboarding_stage?: string | null
  onboarding_stage_due_at?: string | null
}

export interface TrustFrameworkParticipantListQuery {
  cursor?: string
  limit?: number
  role?: string
  status?: string
}

export interface TrustFrameworkParticipantPage {
  rows: StoredTrustFrameworkParticipant[]
  next_cursor: string | null
}

const SELECT_COLUMNS = `id, role, organisation_id, holder_ref, holder_display_name, onboarding_stage,
  individual_tnc_status, organisational_tnc_status, onboarding_stage_due_at, status,
  nominated_replacement_ref, created_at, updated_at`

const LINEAGE_COLUMNS = [
  'bank_id', 'channel', 'role', 'organisation_id', 'holder_ref', 'individual_tnc_status',
  'organisational_tnc_status', 'status', 'nominated_replacement_ref'
]

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v))
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v))

function toRecord(r: Record<string, unknown>): StoredTrustFrameworkParticipant {
  return {
    id: r.id as string,
    role: r.role as string,
    organisation_id: r.organisation_id as string,
    holder_ref: r.holder_ref as string,
    holder_display_name: r.holder_display_name as string,
    onboarding_stage: (r.onboarding_stage as string) ?? null,
    individual_tnc_status: r.individual_tnc_status as string,
    organisational_tnc_status: r.organisational_tnc_status as string,
    onboarding_stage_due_at: isoOrNull(r.onboarding_stage_due_at),
    status: r.status as string,
    nominated_replacement_ref: (r.nominated_replacement_ref as string) ?? null,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at)
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

export class PgTrustFrameworkParticipantStore {
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
        table: 'trust_framework_participant',
        columns: LINEAGE_COLUMNS,
        source: 'bff-trust-framework-store',
        trace_id: traceId
      })
    } catch {
      /* catalogue unavailable — the regulated write stands; Q4.5 surfaces persistent gaps */
    }
  }

  async create(input: TrustFrameworkParticipantCreateInput, traceId: string): Promise<StoredTrustFrameworkParticipant> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `INSERT INTO trust_framework_participant
           (bank_id, channel, role, organisation_id, holder_ref, holder_display_name,
            onboarding_stage, onboarding_stage_due_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${SELECT_COLUMNS}`,
        [
          this.config.bankId,
          this.config.channel,
          input.role,
          input.organisation_id,
          input.holder_ref,
          input.holder_display_name,
          input.onboarding_stage ?? null,
          input.onboarding_stage_due_at ?? null
        ]
      )
      return res.rows[0]
    })
    await this.emitLineage(traceId)
    return toRecord(row)
  }

  async get(id: string): Promise<StoredTrustFrameworkParticipant | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(`SELECT ${SELECT_COLUMNS} FROM trust_framework_participant WHERE id = $1`, [id])
      return res.rows[0] ?? null
    })
    return row ? toRecord(row) : null
  }

  /** Turnover / T&C / stage update. Mutable workflow table (RLS UPDATE); stamps updated_at. */
  async update(id: string, patch: TrustFrameworkParticipantUpdate, traceId: string): Promise<StoredTrustFrameworkParticipant | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `UPDATE trust_framework_participant
            SET status                    = COALESCE($2, status),
                nominated_replacement_ref = COALESCE($3, nominated_replacement_ref),
                individual_tnc_status     = COALESCE($4, individual_tnc_status),
                organisational_tnc_status = COALESCE($5, organisational_tnc_status),
                onboarding_stage          = COALESCE($6, onboarding_stage),
                onboarding_stage_due_at   = COALESCE($7, onboarding_stage_due_at),
                updated_at                = now()
          WHERE id = $1
          RETURNING ${SELECT_COLUMNS}`,
        [
          id,
          patch.status ?? null,
          patch.nominated_replacement_ref ?? null,
          patch.individual_tnc_status ?? null,
          patch.organisational_tnc_status ?? null,
          patch.onboarding_stage ?? null,
          patch.onboarding_stage_due_at ?? null
        ]
      )
      return res.rows[0] ?? null
    })
    if (row) await this.emitLineage(traceId)
    return row ? toRecord(row) : null
  }

  async list(query: TrustFrameworkParticipantListQuery = {}): Promise<TrustFrameworkParticipantPage> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const after = query.cursor ? decodeCursor(query.cursor) : null
    const rows = await this.asApp(async (c) => {
      const params: unknown[] = []
      const where: string[] = []
      if (query.role) {
        params.push(query.role)
        where.push(`role = $${params.length}`)
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
        `SELECT ${SELECT_COLUMNS} FROM trust_framework_participant
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
