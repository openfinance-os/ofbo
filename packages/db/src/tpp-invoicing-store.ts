import pg from 'pg'
import { beginAppTx } from './tenant-tx.js'
import type { LineageSink } from './lineage.js'

/**
 * BACKOFFICE-73 — monthly TPP invoicing stores. billing_record_set (ingested
 * Nebras billing files) and invoice_run (four-eyes invoice runs to P9), both
 * mutable workflow tables: writes run as ofbo_app with the tenancy context set
 * (RLS binds), column-level BCBS 239 lineage at write time.
 */

export interface Money {
  amount: number
  currency: string
}

export interface StoredBillingRecordSet {
  record_set_id: string
  billing_period: string
  ingested_at: string
  ingested_by: string
  source_note: string | null
  integrity_hash: string
  line_count: number
  status: string
  open_break_count: number
  nebras_billing_query_refs: string[]
}

export interface BillingRecordCreateInput {
  billing_period: string
  ingested_by: string
  source_note?: string | null
  integrity_hash: string
  line_count: number
}

export interface BillingRecordListQuery {
  cursor?: string
  limit?: number
  billing_period?: string
}

export interface BillingRecordPage {
  rows: StoredBillingRecordSet[]
  next_cursor: string | null
}

export interface StoredInvoiceRun {
  invoice_run_id: string
  billing_period: string
  record_set_id: string
  status: string
  approval_id: string | null
  invoices: unknown[]
  withheld_line_count: number
  net_settlement_offset: Money | null
}

export interface InvoiceRunCreateInput {
  billing_period: string
  record_set_id: string
  status?: string
  approval_id?: string | null
  invoices?: unknown[]
  withheld_line_count?: number
  net_settlement_offset?: Money | null
}

export interface InvoiceRunListQuery {
  cursor?: string
  limit?: number
}
export interface InvoiceRunPage {
  rows: StoredInvoiceRun[]
  next_cursor: string | null
}

const REC_COLS = `id, billing_period, ingested_at, ingested_by, source_note, integrity_hash, line_count, status, open_break_count, nebras_billing_query_refs`
const INV_COLS = `id, billing_period, record_set_id, status, approval_id, invoices, withheld_line_count, net_settlement_offset_amount, net_settlement_offset_currency`
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v))

function toRecordSet(r: Record<string, unknown>): StoredBillingRecordSet {
  return {
    record_set_id: r.id as string,
    billing_period: r.billing_period as string,
    ingested_at: iso(r.ingested_at),
    ingested_by: r.ingested_by as string,
    source_note: (r.source_note as string) ?? null,
    integrity_hash: r.integrity_hash as string,
    line_count: Number(r.line_count),
    status: r.status as string,
    open_break_count: Number(r.open_break_count),
    nebras_billing_query_refs: (r.nebras_billing_query_refs as string[]) ?? []
  }
}
function toInvoiceRun(r: Record<string, unknown>): StoredInvoiceRun {
  return {
    invoice_run_id: r.id as string,
    billing_period: r.billing_period as string,
    record_set_id: r.record_set_id as string,
    status: r.status as string,
    approval_id: (r.approval_id as string) ?? null,
    invoices: (r.invoices as unknown[]) ?? [],
    withheld_line_count: Number(r.withheld_line_count),
    net_settlement_offset:
      r.net_settlement_offset_amount !== null && r.net_settlement_offset_amount !== undefined
        ? { amount: Number(r.net_settlement_offset_amount), currency: r.net_settlement_offset_currency as string }
        : null
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
  protected async emit(table: string, columns: string[], traceId: string): Promise<void> {
    try {
      await this.lineage?.emitLineage({ table, columns, source: 'tpp-invoicing', trace_id: traceId })
    } catch {
      /* catalogue unavailable — the regulated write stands; Q4.5 surfaces persistent gaps */
    }
  }
  async close(): Promise<void> {
    await this.pool.end()
  }
}

const REC_LINEAGE = ['bank_id', 'channel', 'billing_period', 'ingested_by', 'integrity_hash', 'line_count', 'status', 'open_break_count']

export class PgBillingRecordStore extends TenantStore {
  async create(input: BillingRecordCreateInput, traceId: string): Promise<StoredBillingRecordSet> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `INSERT INTO billing_record_set (bank_id, channel, billing_period, ingested_by, source_note, integrity_hash, line_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${REC_COLS}`,
        [this.config.bankId, this.config.channel, input.billing_period, input.ingested_by, input.source_note ?? null, input.integrity_hash, input.line_count]
      )
      return res.rows[0]
    })
    await this.emit('billing_record_set', REC_LINEAGE, traceId)
    return toRecordSet(row)
  }

  async markReconciled(id: string, status: string, openBreakCount: number, queryRefs: string[], traceId: string): Promise<StoredBillingRecordSet | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `UPDATE billing_record_set SET status = $2, open_break_count = $3, nebras_billing_query_refs = $4::jsonb
          WHERE id = $1 RETURNING ${REC_COLS}`,
        [id, status, openBreakCount, JSON.stringify(queryRefs)]
      )
      return res.rows[0] ?? null
    })
    if (row) await this.emit('billing_record_set', REC_LINEAGE, traceId)
    return row ? toRecordSet(row) : null
  }

  async get(id: string): Promise<StoredBillingRecordSet | null> {
    const row = await this.asApp(async (c) => (await c.query(`SELECT ${REC_COLS} FROM billing_record_set WHERE id = $1`, [id])).rows[0] ?? null)
    return row ? toRecordSet(row) : null
  }

  async list(query: BillingRecordListQuery = {}): Promise<BillingRecordPage> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
    const after = query.cursor ? decodeCursor(query.cursor) : null
    const rows = await this.asApp(async (c) => {
      const params: unknown[] = []
      const where: string[] = []
      if (query.billing_period) {
        params.push(query.billing_period)
        where.push(`billing_period = $${params.length}`)
      }
      if (after) {
        params.push(after.createdAt, after.id)
        where.push(`(date_trunc('milliseconds', created_at), id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`)
      }
      return (
        await c.query(
          `SELECT ${REC_COLS}, created_at FROM billing_record_set ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY date_trunc('milliseconds', created_at) DESC, id DESC LIMIT ${limit + 1}`,
          params
        )
      ).rows
    })
    const hasMore = rows.length > limit
    const slice = hasMore ? rows.slice(0, limit) : rows
    const lastRaw = slice[slice.length - 1]
    return {
      rows: slice.map(toRecordSet),
      next_cursor: hasMore && lastRaw ? encodeCursor(iso(lastRaw.created_at), lastRaw.id as string) : null
    }
  }
}

const INV_LINEAGE = ['bank_id', 'channel', 'billing_period', 'record_set_id', 'status', 'approval_id', 'withheld_line_count']

export class PgInvoiceRunStore extends TenantStore {
  async create(input: InvoiceRunCreateInput, traceId: string): Promise<StoredInvoiceRun> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `INSERT INTO invoice_run (bank_id, channel, billing_period, record_set_id, status, approval_id, invoices, withheld_line_count, net_settlement_offset_amount, net_settlement_offset_currency)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10) RETURNING ${INV_COLS}`,
        [
          this.config.bankId,
          this.config.channel,
          input.billing_period,
          input.record_set_id,
          input.status ?? 'pending_approval',
          input.approval_id ?? null,
          JSON.stringify(input.invoices ?? []),
          input.withheld_line_count ?? 0,
          input.net_settlement_offset?.amount ?? null,
          input.net_settlement_offset?.currency ?? null
        ]
      )
      return res.rows[0]
    })
    await this.emit('invoice_run', INV_LINEAGE, traceId)
    return toInvoiceRun(row)
  }

  async markStatus(id: string, status: string, patch: { invoices?: unknown[] }, traceId: string): Promise<StoredInvoiceRun | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `UPDATE invoice_run SET status = $2, invoices = COALESCE($3::jsonb, invoices) WHERE id = $1 RETURNING ${INV_COLS}`,
        [id, status, patch.invoices ? JSON.stringify(patch.invoices) : null]
      )
      return res.rows[0] ?? null
    })
    if (row) await this.emit('invoice_run', INV_LINEAGE, traceId)
    return row ? toInvoiceRun(row) : null
  }

  async get(id: string): Promise<StoredInvoiceRun | null> {
    const row = await this.asApp(async (c) => (await c.query(`SELECT ${INV_COLS} FROM invoice_run WHERE id = $1`, [id])).rows[0] ?? null)
    return row ? toInvoiceRun(row) : null
  }

  async list(query: InvoiceRunListQuery = {}): Promise<InvoiceRunPage> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
    const after = query.cursor ? decodeCursor(query.cursor) : null
    const rows = await this.asApp(async (c) => {
      const params: unknown[] = []
      const where: string[] = []
      if (after) {
        params.push(after.createdAt, after.id)
        where.push(`(date_trunc('milliseconds', created_at), id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`)
      }
      return (
        await c.query(
          `SELECT ${INV_COLS}, created_at FROM invoice_run ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY date_trunc('milliseconds', created_at) DESC, id DESC LIMIT ${limit + 1}`,
          params
        )
      ).rows
    })
    const hasMore = rows.length > limit
    const slice = hasMore ? rows.slice(0, limit) : rows
    const lastRaw = slice[slice.length - 1]
    return {
      rows: slice.map(toInvoiceRun),
      next_cursor: hasMore && lastRaw ? encodeCursor(iso(lastRaw.created_at), lastRaw.id as string) : null
    }
  }
}
