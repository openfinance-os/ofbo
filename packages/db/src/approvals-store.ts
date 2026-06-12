import pg from 'pg'
import type { LineageSink } from './lineage.js'

/**
 * M1-DEMO-DEPLOY: durable ApprovalStore over the approval_request table.
 * Structural match for the BFF's ApprovalStore interface (no package dependency
 * on the BFF — same precedent as AuthSinkEvent in audit.ts). Every statement
 * runs as ofbo_app with the tenancy context set, so RLS binds; lineage is
 * emitted at write time (BCBS 239, never retrofitted).
 */

export type StoredApprovalState = 'pending' | 'approved' | 'rejected' | 'timed_out'

export interface StoredApprovalRecord {
  approval_request_id: string
  operation_type: string
  operation_payload: Record<string, unknown>
  state: StoredApprovalState
  initiator: string
  approver_required_scope: string
  approver: string | null
  expires_at: string
  reject_reason: string | null
  execution_result?: unknown
}

const APPROVAL_COLUMNS = [
  'bank_id', 'channel', 'approval_request_id', 'operation_type', 'operation_payload',
  'state', 'initiator', 'approver_required_scope', 'approver', 'expires_at',
  'reject_reason', 'execution_result'
]

const SELECT_COLUMNS = `approval_request_id, operation_type, operation_payload, state,
  initiator, approver_required_scope, approver,
  to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at,
  reject_reason, execution_result`

interface ApprovalRow {
  approval_request_id: string
  operation_type: string
  operation_payload: Record<string, unknown>
  state: StoredApprovalState
  initiator: string
  approver_required_scope: string
  approver: string | null
  expires_at: string
  reject_reason: string | null
  execution_result: unknown
}

function toRecord(row: ApprovalRow): StoredApprovalRecord {
  return {
    approval_request_id: row.approval_request_id,
    operation_type: row.operation_type,
    operation_payload: row.operation_payload,
    state: row.state,
    initiator: row.initiator,
    approver_required_scope: row.approver_required_scope,
    approver: row.approver,
    expires_at: row.expires_at,
    reject_reason: row.reject_reason,
    ...(row.execution_result === null ? {} : { execution_result: row.execution_result })
  }
}

export class PgApprovalStore {
  private readonly pool: pg.Pool

  constructor(
    databaseUrl: string,
    private readonly config: { bankId: string; channel: string },
    private readonly lineage?: LineageSink
  ) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
  }

  /** Runs fn as ofbo_app with the tenancy context set — RLS binds every statement. */
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

  /** Best-effort lineage at write time — the regulated write never depends on it. */
  private async emitLineage(): Promise<void> {
    try {
      await this.lineage?.emitLineage({
        table: 'approval_request',
        columns: APPROVAL_COLUMNS,
        source: 'bff-approval-store',
        trace_id: 'approval-store'
      })
    } catch {
      /* catalogue unavailable — write stands; Q4.5 surfaces persistent gaps */
    }
  }

  async create(r: StoredApprovalRecord): Promise<void> {
    await this.asApp((c) =>
      c.query(
        `INSERT INTO approval_request
           (bank_id, channel, approval_request_id, operation_type, operation_payload,
            state, initiator, approver_required_scope, approver, expires_at,
            reject_reason, execution_result)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
        [
          this.config.bankId,
          this.config.channel,
          r.approval_request_id,
          r.operation_type,
          JSON.stringify(r.operation_payload),
          r.state,
          r.initiator,
          r.approver_required_scope,
          r.approver,
          r.expires_at,
          r.reject_reason,
          r.execution_result === undefined ? null : JSON.stringify(r.execution_result)
        ]
      )
    )
    await this.emitLineage()
  }

  async get(id: string): Promise<StoredApprovalRecord | null> {
    const rows = await this.asApp(async (c) => {
      const res = await c.query<ApprovalRow>(
        `SELECT ${SELECT_COLUMNS} FROM approval_request WHERE approval_request_id = $1`,
        [id]
      )
      return res.rows
    })
    return rows[0] ? toRecord(rows[0]) : null
  }

  async update(r: StoredApprovalRecord): Promise<void> {
    await this.asApp((c) =>
      c.query(
        `UPDATE approval_request
            SET state = $2, approver = $3, reject_reason = $4, execution_result = $5::jsonb
          WHERE approval_request_id = $1`,
        [
          r.approval_request_id,
          r.state,
          r.approver,
          r.reject_reason,
          r.execution_result === undefined ? null : JSON.stringify(r.execution_result)
        ]
      )
    )
    await this.emitLineage()
  }

  async listPending(): Promise<StoredApprovalRecord[]> {
    const rows = await this.asApp(async (c) => {
      const res = await c.query<ApprovalRow>(
        `SELECT ${SELECT_COLUMNS} FROM approval_request WHERE state = 'pending' ORDER BY created_at, approval_request_id`
      )
      return res.rows
    })
    return rows.map(toRecord)
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
