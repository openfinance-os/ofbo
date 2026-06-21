import pg from 'pg'
import { beginAppTx } from './tenant-tx.js'
import type { LineageSink } from './lineage.js'

/**
 * BACKOFFICE-77 — fraud_incident persistence. Extends the BACKOFFICE-22 fraud
 * workflow with the Nebras-helpdesk report step. Writes run as ofbo_app with the
 * tenancy context set (RLS binds). fraud_incident is a mutable workflow table
 * (open → reported → resolved). Column-level BCBS 239 lineage at write time.
 */

export interface StoredFraudIncident {
  id: string
  consent_id: string | null
  client_id: string | null
  nebras_severity: string
  itsm_priority: string
  nebras_case_reference: string | null
  status: string
  operational_pause: boolean
  scheme_imposed_hold: boolean
  summary: string
  opened_by: string
  opened_at: string
  reported_at: string | null
  resolved_at: string | null
}

export interface FraudIncidentCreateInput {
  consent_id?: string | null
  client_id?: string | null
  nebras_severity: string
  itsm_priority: string
  nebras_case_reference?: string | null
  status: string
  operational_pause: boolean
  scheme_imposed_hold: boolean
  summary: string
  opened_by: string
  reported_at?: string | null
}

export interface FraudIncidentUpdate {
  status?: string
  operational_pause?: boolean
  resolved_at?: string | null
}

export interface FraudIncidentListQuery {
  cursor?: string
  limit?: number
  status?: string
  nebras_severity?: string
}

export interface FraudIncidentPage {
  rows: StoredFraudIncident[]
  next_cursor: string | null
}

const SELECT_COLUMNS = `id, consent_id, client_id, nebras_severity, itsm_priority,
  nebras_case_reference, status, operational_pause, scheme_imposed_hold, summary,
  opened_by, opened_at, reported_at, resolved_at, created_at`

const LINEAGE_COLUMNS = [
  'bank_id', 'channel', 'consent_id', 'client_id', 'nebras_severity', 'itsm_priority',
  'nebras_case_reference', 'status', 'operational_pause', 'scheme_imposed_hold'
]

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v))
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v))

function toRecord(r: Record<string, unknown>): StoredFraudIncident {
  return {
    id: r.id as string,
    consent_id: (r.consent_id as string) ?? null,
    client_id: (r.client_id as string) ?? null,
    nebras_severity: r.nebras_severity as string,
    itsm_priority: r.itsm_priority as string,
    nebras_case_reference: (r.nebras_case_reference as string) ?? null,
    status: r.status as string,
    operational_pause: Boolean(r.operational_pause),
    scheme_imposed_hold: Boolean(r.scheme_imposed_hold),
    summary: r.summary as string,
    opened_by: r.opened_by as string,
    opened_at: iso(r.opened_at),
    reported_at: isoOrNull(r.reported_at),
    resolved_at: isoOrNull(r.resolved_at)
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

export class PgFraudIncidentStore {
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
        table: 'fraud_incident',
        columns: LINEAGE_COLUMNS,
        source: 'bff-fraud-incident-store',
        trace_id: traceId
      })
    } catch {
      /* catalogue unavailable — the regulated write stands; Q4.5 surfaces persistent gaps */
    }
  }

  async create(input: FraudIncidentCreateInput, traceId: string): Promise<StoredFraudIncident> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `INSERT INTO fraud_incident
           (bank_id, channel, consent_id, client_id, nebras_severity, itsm_priority,
            nebras_case_reference, status, operational_pause, scheme_imposed_hold, summary,
            opened_by, reported_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING ${SELECT_COLUMNS}`,
        [
          this.config.bankId,
          this.config.channel,
          input.consent_id ?? null,
          input.client_id ?? null,
          input.nebras_severity,
          input.itsm_priority,
          input.nebras_case_reference ?? null,
          input.status,
          input.operational_pause,
          input.scheme_imposed_hold,
          input.summary,
          input.opened_by,
          input.reported_at ?? null
        ]
      )
      return res.rows[0]
    })
    await this.emitLineage(traceId)
    return toRecord(row)
  }

  async get(id: string): Promise<StoredFraudIncident | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(`SELECT ${SELECT_COLUMNS} FROM fraud_incident WHERE id = $1`, [id])
      return res.rows[0] ?? null
    })
    return row ? toRecord(row) : null
  }

  /** Resolve / update an incident. fraud_incident is a mutable workflow table (RLS UPDATE). */
  async update(id: string, patch: FraudIncidentUpdate, traceId: string): Promise<StoredFraudIncident | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `UPDATE fraud_incident
            SET status            = COALESCE($2, status),
                operational_pause = COALESCE($3, operational_pause),
                resolved_at       = COALESCE($4, resolved_at)
          WHERE id = $1
          RETURNING ${SELECT_COLUMNS}`,
        [id, patch.status ?? null, patch.operational_pause ?? null, patch.resolved_at ?? null]
      )
      return res.rows[0] ?? null
    })
    if (row) await this.emitLineage(traceId)
    return row ? toRecord(row) : null
  }

  async list(query: FraudIncidentListQuery = {}): Promise<FraudIncidentPage> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const after = query.cursor ? decodeCursor(query.cursor) : null
    const rows = await this.asApp(async (c) => {
      const params: unknown[] = []
      const where: string[] = []
      if (query.status) {
        params.push(query.status)
        where.push(`status = $${params.length}`)
      }
      if (query.nebras_severity) {
        params.push(query.nebras_severity)
        where.push(`nebras_severity = $${params.length}`)
      }
      if (after) {
        params.push(after.createdAt, after.id)
        where.push(`(date_trunc('milliseconds', created_at), id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`)
      }
      const res = await c.query(
        `SELECT ${SELECT_COLUMNS} FROM fraud_incident
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY date_trunc('milliseconds', created_at), id
         LIMIT ${limit + 1}`,
        params
      )
      return res.rows
    })
    const hasMore = rows.length > limit
    const page = (hasMore ? rows.slice(0, limit) : rows)
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
