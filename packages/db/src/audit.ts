import pg from 'pg'
import { redactPii } from './redact.js'

/**
 * BACKOFFICE-45: the DB-backed High-class audit emitter. INSERT-only by
 * construction — every statement runs as the ofbo_app role inside a transaction
 * with the tenancy context set, so RLS tenancy and the INSERT-only policies bind
 * (defence in depth on top of the schema-level REVOKEs). PII is redacted at
 * emission; raw bodies never reach the table.
 */

export interface HighClassAuditEvent {
  event_type: string
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

/** Structural match for the BFF AuthAuditSink event — no package dependency on the BFF. */
export interface AuthSinkEvent {
  event_type: 'signin_success' | 'signin_failure' | 'scope_denied'
  acting_principal: string
  acting_persona: string | null
  reason: string | null
  trace_id: string
  attempted_scope?: string | null
  superadmin_marker?: boolean
}

export interface AuditEmitterConfig {
  bankId: string
  channel: string
}

export class PgAuditEmitter {
  private readonly pool: pg.Pool
  constructor(databaseUrl: string, private readonly config: AuditEmitterConfig) {
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
            request_trace_id, request_body_redacted, response_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`,
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
          event.response_status
        ]
      )
    )
  }

  /** AuthAuditSink-compatible: lets the BFF swap its in-memory sink for this emitter. */
  async record(event: AuthSinkEvent): Promise<void> {
    await this.emit({
      event_type: event.event_type,
      acting_principal: event.acting_principal,
      acting_persona: event.acting_persona ?? 'unknown',
      scope_used: event.attempted_scope ?? 'none',
      request_trace_id: event.trace_id,
      request_body: {
        reason: event.reason,
        superadmin_marker: event.superadmin_marker ?? false
      },
      response_status: event.event_type === 'signin_success' ? 200 : event.event_type === 'scope_denied' ? 403 : 401
    })
  }

  /** Test/diagnostics only: runs under the same constrained role — proves INSERT-only binds this emitter. */
  async dangerousRawQuery(sql: string, params: unknown[]): Promise<unknown> {
    return this.asApp((c) => c.query(sql, params))
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
