import pg from 'pg'
import { redactPii } from '@ofbo/redaction'
import type { LineageSink } from './lineage.js'

/**
 * BACKOFFICE-23 — compliance_report persistence (the CBUAE inquiry bundle and,
 * later, periodic reports). Writes run as ofbo_app with the tenancy context set
 * (RLS binds). The bundle `content` (with line-level integrity hashes) is
 * PII-redacted at emission. Column-level BCBS 239 lineage at write time.
 */

export interface StoredComplianceReport {
  id: string
  report_type: string
  status: string
  reporting_period_start: string
  reporting_period_end: string
  classification: string
  requested_by: string
  approved_by: string | null
  integrity_hash: string | null
  generated_at: string | null
  submitted_at: string | null
  approval_id: string | null
  created_at: string
}

export interface ComplianceReportCreateInput {
  report_type: string
  status: string
  reporting_period_start: string
  reporting_period_end: string
  classification?: string
  requested_by: string
  /** BACKOFFICE-06 — the IdP-attested sign-off principal (set when generated+locked). */
  approved_by?: string | null
  integrity_hash?: string | null
  generated_at?: string | null
  /** BACKOFFICE-35 — four-eyes link for a CBUAE-bound report (resolved via :approve). */
  approval_id?: string | null
  content?: unknown
}

export interface ComplianceReportListQuery {
  cursor?: string
  limit?: number
  report_type?: string
  status?: string
}
export interface ComplianceReportPage {
  rows: StoredComplianceReport[]
  next_cursor: string | null
}

const SELECT_COLUMNS = `id, report_type, status, reporting_period_start, reporting_period_end,
  classification, requested_by, approved_by, integrity_hash, generated_at, submitted_at, approval_id, created_at`

const encodeCursor = (createdAt: string, id: string) => Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url')
function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
    return createdAt && id ? { createdAt, id } : null
  } catch {
    return null
  }
}

const LINEAGE_COLUMNS = [
  'bank_id', 'channel', 'report_type', 'status', 'reporting_period_start',
  'reporting_period_end', 'classification', 'requested_by', 'approved_by', 'integrity_hash', 'content'
]

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v))

function toRecord(r: Record<string, unknown>): StoredComplianceReport {
  return {
    id: r.id as string,
    report_type: r.report_type as string,
    status: r.status as string,
    reporting_period_start: iso(r.reporting_period_start),
    reporting_period_end: iso(r.reporting_period_end),
    classification: r.classification as string,
    requested_by: r.requested_by as string,
    approved_by: (r.approved_by as string) ?? null,
    integrity_hash: (r.integrity_hash as string) ?? null,
    generated_at: r.generated_at ? iso(r.generated_at) : null,
    submitted_at: r.submitted_at ? iso(r.submitted_at) : null,
    approval_id: (r.approval_id as string) ?? null,
    created_at: iso(r.created_at)
  }
}

export class PgComplianceReportStore {
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

  async create(input: ComplianceReportCreateInput, traceId: string): Promise<StoredComplianceReport> {
    const content = JSON.stringify(redactPii(input.content ?? null))
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `INSERT INTO compliance_report
           (bank_id, channel, report_type, status, reporting_period_start, reporting_period_end,
            classification, requested_by, approved_by, integrity_hash, generated_at, approval_id, content)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
         RETURNING ${SELECT_COLUMNS}`,
        [
          this.config.bankId,
          this.config.channel,
          input.report_type,
          input.status,
          input.reporting_period_start,
          input.reporting_period_end,
          input.classification ?? 'restricted',
          input.requested_by,
          input.approved_by ?? null,
          input.integrity_hash ?? null,
          input.generated_at ?? null,
          input.approval_id ?? null,
          content
        ]
      )
      return res.rows[0]
    })
    try {
      await this.lineage?.emitLineage({
        table: 'compliance_report',
        columns: LINEAGE_COLUMNS,
        source: 'bff-inquiry-bundle',
        trace_id: traceId
      })
    } catch {
      /* catalogue unavailable — the regulated write stands; Q4.5 surfaces persistent gaps */
    }
    return toRecord(row)
  }

  async get(id: string): Promise<StoredComplianceReport | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(`SELECT ${SELECT_COLUMNS} FROM compliance_report WHERE id = $1`, [id])
      return res.rows[0] ?? null
    })
    return row ? toRecord(row) : null
  }

  /** BACKOFFICE-35 — the stored (PII-redacted) content for the download endpoint. */
  async getContent(id: string): Promise<unknown | null> {
    return this.asApp(async (c) => {
      const res = await c.query(`SELECT content FROM compliance_report WHERE id = $1`, [id])
      return res.rows[0]?.content ?? null
    })
  }

  /** BACKOFFICE-35 — status lifecycle transitions (awaiting_approval → approved → submitted). */
  async markStatus(
    id: string,
    status: string,
    patch: { approved_by?: string | null; submitted_at?: string | null; approval_id?: string | null } = {},
    traceId?: string
  ): Promise<StoredComplianceReport | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `UPDATE compliance_report
            SET status = $2,
                approved_by = COALESCE($3, approved_by),
                submitted_at = COALESCE($4, submitted_at),
                approval_id = COALESCE($5, approval_id)
          WHERE id = $1 RETURNING ${SELECT_COLUMNS}`,
        [id, status, patch.approved_by ?? null, patch.submitted_at ?? null, patch.approval_id ?? null]
      )
      return res.rows[0] ?? null
    })
    if (row && traceId) {
      try {
        await this.lineage?.emitLineage({ table: 'compliance_report', columns: LINEAGE_COLUMNS, source: 'bff-report-generation', trace_id: traceId })
      } catch {
        /* catalogue unavailable — the regulated write stands */
      }
    }
    return row ? toRecord(row) : null
  }

  async list(query: ComplianceReportListQuery = {}): Promise<ComplianceReportPage> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
    const after = query.cursor ? decodeCursor(query.cursor) : null
    const rows = await this.asApp(async (c) => {
      const params: unknown[] = []
      const where: string[] = []
      if (query.report_type) {
        params.push(query.report_type)
        where.push(`report_type = $${params.length}`)
      }
      if (query.status) {
        params.push(query.status)
        where.push(`status = $${params.length}`)
      }
      if (after) {
        params.push(after.createdAt, after.id)
        where.push(`(date_trunc('milliseconds', created_at), id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`)
      }
      return (
        await c.query(
          `SELECT ${SELECT_COLUMNS} FROM compliance_report ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY date_trunc('milliseconds', created_at) DESC, id DESC LIMIT ${limit + 1}`,
          params
        )
      ).rows
    })
    const hasMore = rows.length > limit
    const slice = (hasMore ? rows.slice(0, limit) : rows).map(toRecord)
    const last = slice[slice.length - 1]
    return { rows: slice, next_cursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
