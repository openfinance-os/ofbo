import pg from 'pg'
import type { LineageSink } from './lineage.js'

/**
 * BACKOFFICE-20 — dispute_case persistence. Writes run as ofbo_app with the
 * tenancy context set (RLS binds). dispute_case is a mutable workflow table;
 * this store creates and reads (the state-machine UPDATE path lands with the
 * dispute-lifecycle slice). Column-level BCBS 239 lineage at write time.
 */

export interface Money {
  amount: number
  currency: string
}

export interface StoredDisputeRecord {
  id: string
  psu_identifier: string
  dispute_type: string
  state: string
  originating_payment_id: string | null
  originating_consent_id: string | null
  originating_call_id: string | null
  dispute_reason_code: string | null
  sla_clock_started_at: string
  refund_required_by: string | null
  refund_initiated_at: string | null
  refund_amount: Money | null
  nebras_case_id: string | null
  care_case_id: string | null
  assigned_to: string | null
  created_at: string
}

export interface DisputeCreateInput {
  psu_identifier: string
  dispute_type: string
  originating_payment_id?: string | null
  originating_consent_id?: string | null
  originating_call_id?: string | null
  dispute_reason_code?: string | null
  nebras_case_id?: string | null
}

export interface DisputeListQuery {
  cursor?: string
  limit?: number
  state?: string
  psu_identifier?: string
}

export interface DisputePage {
  rows: StoredDisputeRecord[]
  next_cursor: string | null
}

const SELECT_COLUMNS = `id, psu_identifier, dispute_type, state, originating_payment_id,
  originating_consent_id, originating_call_id, dispute_reason_code, sla_clock_started_at,
  refund_required_by, refund_initiated_at, refund_amount, refund_currency, nebras_case_id,
  care_case_id, assigned_to, created_at`

const LINEAGE_COLUMNS = [
  'bank_id', 'channel', 'psu_identifier', 'dispute_type', 'state',
  'originating_payment_id', 'originating_consent_id', 'dispute_reason_code', 'nebras_case_id'
]

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v))

function toRecord(r: Record<string, unknown>): StoredDisputeRecord {
  return {
    id: r.id as string,
    psu_identifier: r.psu_identifier as string,
    dispute_type: r.dispute_type as string,
    state: r.state as string,
    originating_payment_id: (r.originating_payment_id as string) ?? null,
    originating_consent_id: (r.originating_consent_id as string) ?? null,
    originating_call_id: (r.originating_call_id as string) ?? null,
    dispute_reason_code: (r.dispute_reason_code as string) ?? null,
    sla_clock_started_at: iso(r.sla_clock_started_at),
    refund_required_by: r.refund_required_by ? iso(r.refund_required_by) : null,
    refund_initiated_at: r.refund_initiated_at ? iso(r.refund_initiated_at) : null,
    refund_amount:
      r.refund_amount !== null && r.refund_amount !== undefined
        ? { amount: Number(r.refund_amount), currency: r.refund_currency as string }
        : null,
    nebras_case_id: (r.nebras_case_id as string) ?? null,
    care_case_id: (r.care_case_id as string) ?? null,
    assigned_to: (r.assigned_to as string) ?? null,
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

export class PgDisputeStore {
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
        table: 'dispute_case',
        columns: LINEAGE_COLUMNS,
        source: 'bff-dispute-store',
        trace_id: traceId
      })
    } catch {
      /* catalogue unavailable — the regulated write stands; Q4.5 surfaces persistent gaps */
    }
  }

  async create(input: DisputeCreateInput, traceId: string): Promise<StoredDisputeRecord> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `INSERT INTO dispute_case
           (bank_id, channel, psu_identifier, dispute_type, originating_payment_id,
            originating_consent_id, originating_call_id, dispute_reason_code, nebras_case_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING ${SELECT_COLUMNS}`,
        [
          this.config.bankId,
          this.config.channel,
          input.psu_identifier,
          input.dispute_type,
          input.originating_payment_id ?? null,
          input.originating_consent_id ?? null,
          input.originating_call_id ?? null,
          input.dispute_reason_code ?? null,
          input.nebras_case_id ?? null
        ]
      )
      return res.rows[0]
    })
    await this.emitLineage(traceId)
    return toRecord(row)
  }

  async get(id: string): Promise<StoredDisputeRecord | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(`SELECT ${SELECT_COLUMNS} FROM dispute_case WHERE id = $1`, [id])
      return res.rows[0] ?? null
    })
    return row ? toRecord(row) : null
  }

  /** BACKOFFICE-21: move a dispute to refund_initiated with the next-business-day
   *  SLA deadline recorded. dispute_case is a mutable workflow table (RLS UPDATE). */
  async markRefundInitiated(
    id: string,
    refundAmount: Money,
    refundRequiredBy: string,
    traceId: string
  ): Promise<StoredDisputeRecord | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `UPDATE dispute_case
            SET state = 'refund_initiated',
                refund_initiated_at = now(),
                refund_required_by = $2,
                refund_amount = $3,
                refund_currency = $4
          WHERE id = $1
          RETURNING ${SELECT_COLUMNS}`,
        [id, refundRequiredBy, refundAmount.amount, refundAmount.currency]
      )
      return res.rows[0] ?? null
    })
    if (row) await this.emitLineage(traceId)
    return row ? toRecord(row) : null
  }

  /**
   * BACKOFFICE-24: the dispute/complaint state-machine transition. Updates state
   * and the lifecycle metadata (escalated_to / resolution_note) and stamps
   * state_changed_at. Those metadata columns are write-only here — the returned
   * record is the DisputeCase wire projection (SELECT_COLUMNS), so the contract
   * shape is unchanged. dispute_case is a mutable workflow table (RLS UPDATE).
   */
  async updateState(
    id: string,
    patch: { state?: string; escalated_to?: string | null; resolution_note?: string | null },
    traceId: string
  ): Promise<StoredDisputeRecord | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `UPDATE dispute_case
            SET state = COALESCE($2, state),
                escalated_to = COALESCE($3, escalated_to),
                resolution_note = COALESCE($4, resolution_note),
                state_changed_at = now()
          WHERE id = $1
          RETURNING ${SELECT_COLUMNS}`,
        [id, patch.state ?? null, patch.escalated_to ?? null, patch.resolution_note ?? null]
      )
      return res.rows[0] ?? null
    })
    if (row) await this.emitLineage(traceId)
    return row ? toRecord(row) : null
  }

  async list(query: DisputeListQuery = {}): Promise<DisputePage> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const after = query.cursor ? decodeCursor(query.cursor) : null
    const rows = await this.asApp(async (c) => {
      const params: unknown[] = []
      const where: string[] = []
      if (query.state) {
        params.push(query.state)
        where.push(`state = $${params.length}`)
      }
      if (query.psu_identifier) {
        params.push(query.psu_identifier)
        where.push(`psu_identifier = $${params.length}`)
      }
      if (after) {
        params.push(after.createdAt, after.id)
        where.push(`(date_trunc('milliseconds', created_at), id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`)
      }
      const res = await c.query(
        `SELECT ${SELECT_COLUMNS} FROM dispute_case
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
