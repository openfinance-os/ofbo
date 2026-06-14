import pg from 'pg'
import { redactPii } from '@ofbo/redaction'
import type { LineageSink } from './lineage.js'

/**
 * BACKOFFICE-45: the DB-backed High-class audit emitter. INSERT-only by
 * construction — every statement runs as the ofbo_app role inside a transaction
 * with the tenancy context set, so RLS tenancy and the INSERT-only policies bind
 * (defence in depth on top of the schema-level REVOKEs). PII is redacted at
 * emission; raw bodies never reach the table.
 */

export interface HighClassAuditEvent {
  event_type: string
  superadmin_marker?: boolean
  acting_principal: string
  acting_persona: string
  scope_used: string
  target_psu_identifier?: string | null
  target_consent_id?: string | null
  target_dispute_id?: string | null
  request_trace_id: string
  request_body?: unknown
  response_status: number
}

/** Structural match for the BFF AuthAuditSink event — no package dependency on the BFF.
 *  event_type stays open (string) so new BFF lifecycle events (approvals, …) flow through. */
export interface AuthSinkEvent {
  event_type: string
  acting_principal: string
  acting_persona: string | null
  reason: string | null
  trace_id: string
  attempted_scope?: string | null
  superadmin_marker?: boolean
  approval_request_id?: string
  justification?: string
}

export interface AuditEmitterConfig {
  bankId: string
  channel: string
}

const AUDIT_COLUMNS = [
  'bank_id', 'channel', 'event_type', 'acting_principal', 'acting_persona', 'scope_used',
  'target_psu_identifier', 'target_consent_id', 'target_dispute_id',
  'request_trace_id', 'request_body_redacted', 'response_status'
]

export class PgAuditEmitter {
  private readonly pool: pg.Pool
  constructor(
    databaseUrl: string,
    private readonly config: AuditEmitterConfig,
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

  /** General High-class emission for story services. */
  async emit(event: HighClassAuditEvent): Promise<void> {
    const body = JSON.stringify(redactPii(event.request_body ?? {}))
    await this.asApp((c) =>
      c.query(
        `INSERT INTO audit_high_sensitivity
           (bank_id, channel, event_type, acting_principal, acting_persona, scope_used,
            target_psu_identifier, target_consent_id, target_dispute_id,
            request_trace_id, request_body_redacted, response_status, superadmin_marker)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)`,
        [
          this.config.bankId,
          this.config.channel,
          event.event_type,
          event.acting_principal,
          event.acting_persona,
          event.scope_used,
          event.target_psu_identifier ?? null,
          event.target_consent_id ?? null,
          event.target_dispute_id ?? null,
          event.request_trace_id,
          body,
          event.response_status,
          event.superadmin_marker ?? false
        ]
      )
    )
    // BCBS 239 (BACKOFFICE-49): lineage at write time. Best-effort by design —
    // the regulated write itself never depends on catalogue availability.
    try {
      await this.lineage?.emitLineage({
        table: 'audit_high_sensitivity',
        columns: AUDIT_COLUMNS,
        source: 'bff-audit-emitter',
        trace_id: event.request_trace_id
      })
    } catch {
      /* catalogue unavailable — write stands; Q4.5 surfaces persistent gaps */
    }
  }

  /** AuthAuditSink-compatible: lets the BFF swap its in-memory sink for this emitter. */
  async record(event: AuthSinkEvent): Promise<void> {
    await this.emit({
      event_type: event.event_type,
      acting_principal: event.acting_principal,
      acting_persona: event.acting_persona ?? 'unknown',
      scope_used: event.attempted_scope ?? 'none',
      request_trace_id: event.trace_id,
      superadmin_marker: event.superadmin_marker ?? false,
      request_body: {
        reason: event.reason,
        superadmin_marker: event.superadmin_marker ?? false,
        ...(event.approval_request_id ? { approval_request_id: event.approval_request_id } : {}),
        ...(event.justification ? { justification: event.justification } : {})
      },
      response_status:
        event.event_type === 'signin_failure' ? 401 : event.event_type === 'scope_denied' ? 403 : 200
    })
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

/** A single High-class audit row, projected to its non-PII summary fields. The
 *  redacted body never carries PII (redaction happens at emission), so the
 *  portal renders these directly. */
export interface AuditEventSummary {
  id: string
  event_type: string
  acting_principal: string
  acting_persona: string
  scope_used: string
  request_trace_id: string
  response_status: number
  superadmin_marker: boolean
  created_at: string
}

/**
 * Read side of the High-class audit store (M1-PORTAL-SHELL: "audit record
 * emitted and visible"). Reads run as ofbo_app with the tenancy context set, so
 * RLS binds the SELECT to the caller's bank partition exactly as the write path
 * does — the INSERT-only guarantees are untouched (this class never mutates).
 */
export class PgAuditReader {
  private readonly pool: pg.Pool
  constructor(
    databaseUrl: string,
    private readonly config: AuditEmitterConfig
  ) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
  }

  /** Recent events, newest first. Optionally scoped to one acting principal. */
  async recent(opts: { actingPrincipal?: string; limit?: number } = {}): Promise<AuditEventSummary[]> {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100)
    const c = await this.pool.connect()
    try {
      await c.query('BEGIN')
      await c.query('SET LOCAL ROLE ofbo_app')
      await c.query(`SELECT set_config('app.bank_id', $1, true)`, [this.config.bankId])
      const where = opts.actingPrincipal ? 'WHERE acting_principal = $1' : ''
      const params = opts.actingPrincipal ? [opts.actingPrincipal, limit] : [limit]
      const { rows } = await c.query(
        `SELECT id, event_type, acting_principal, acting_persona, scope_used,
                request_trace_id, response_status, superadmin_marker, created_at
           FROM audit_high_sensitivity
           ${where}
           ORDER BY created_at DESC
           LIMIT $${params.length}`,
        params
      )
      await c.query('COMMIT')
      return rows.map((r) => ({
        id: r.id,
        event_type: r.event_type,
        acting_principal: r.acting_principal,
        acting_persona: r.acting_persona,
        scope_used: r.scope_used,
        request_trace_id: r.request_trace_id,
        response_status: r.response_status,
        superadmin_marker: r.superadmin_marker,
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
      }))
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined)
      throw e
    } finally {
      c.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
