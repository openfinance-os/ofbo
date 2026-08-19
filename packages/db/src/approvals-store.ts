import pg from 'pg'
import { beginAppTx } from './tenant-tx.js'
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
  /** Migration 0042. Null while pending, and on rows written before the column existed. */
  approved_at?: string | null
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
  to_char(approved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS approved_at,
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
  approved_at: string | null
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
    approved_at: row.approved_at,
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

  async claimForApproval(id: string, approver: string, approvedAt: string): Promise<boolean> {
    // `WHERE ... AND state = 'pending'` is the compare-and-swap. One statement, so the database
    // serialises the two racing approvers for us: the loser's UPDATE matches zero rows and
    // rowCount tells us which one we were. Doing this as SELECT-then-UPDATE would reopen exactly
    // the window it exists to close.
    const claimed = await this.asApp(async (c) => {
      const res = await c.query(
        `UPDATE approval_request
            SET state = 'approved', approver = $2,
                approved_at = COALESCE(approval_request.approved_at, $3::timestamptz)
          WHERE approval_request_id = $1 AND state = 'pending'`,
        [id, approver, approvedAt]
      )
      return res.rowCount === 1
    })
    if (claimed) await this.emitLineage()
    return claimed
  }

  async update(r: StoredApprovalRecord): Promise<void> {
    await this.asApp((c) =>
      c.query(
        // approved_at is WRITE-ONCE: COALESCE keeps whatever is already there and only fills a
        // NULL. It is four-eyes timing evidence — the field payable dispatch treats as its last
        // gate before money moves, and refuses to proceed without — so a second update that
        // happened not to carry it would otherwise erase it silently. Structural rather than a
        // convention every future caller has to remember.
        `UPDATE approval_request
            SET state = $2, approver = $3, reject_reason = $4, execution_result = $5::jsonb,
                approved_at = COALESCE(approval_request.approved_at, $6::timestamptz)
          WHERE approval_request_id = $1`,
        [
          r.approval_request_id,
          r.state,
          r.approver,
          r.reject_reason,
          r.execution_result === undefined ? null : JSON.stringify(r.execution_result),
          r.approved_at ?? null
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
