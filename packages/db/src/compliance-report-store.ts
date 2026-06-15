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
  created_at: string
}

export interface ComplianceReportCreateInput {
  report_type: string
  status: string
  reporting_period_start: string
  reporting_period_end: string
  classification?: string
  requested_by: string
  integrity_hash?: string | null
  generated_at?: string | null
  content?: unknown
}

const SELECT_COLUMNS = `id, report_type, status, reporting_period_start, reporting_period_end,
  classification, requested_by, approved_by, integrity_hash, generated_at, submitted_at, created_at`

const LINEAGE_COLUMNS = [
  'bank_id', 'channel', 'report_type', 'status', 'reporting_period_start',
  'reporting_period_end', 'classification', 'requested_by', 'integrity_hash', 'content'
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
            classification, requested_by, integrity_hash, generated_at, content)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
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
          input.integrity_hash ?? null,
          input.generated_at ?? null,
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

  async close(): Promise<void> {
    await this.pool.end()
  }
}
