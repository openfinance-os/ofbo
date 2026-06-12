import pg from 'pg'
import type { PgAuditEmitter } from './audit.js'

/**
 * BACKOFFICE-50: retention lifecycle. The schema already denies UPDATE/DELETE on
 * regulated records (RLS + REVOKE); this module makes denial ATTEMPTS visible —
 * every permission-denied mutation becomes a High-class audit event — and the
 * retention posture queryable for the Compliance View (BACKOFFICE-29, M4).
 */

const PERMISSION_DENIED = '42501'

export interface DenialActor {
  acting_principal: string
  acting_persona: string
  trace_id: string
}

/** Wrap any mutation path: permission-denied errors are High-class logged, then rethrown. */
export function withDenialLogging(audit: PgAuditEmitter, actor: DenialActor) {
  return async <T>(tableName: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (e) {
      const code = (e as { code?: string }).code
      const message = (e as Error).message ?? ''
      if (code === PERMISSION_DENIED || /permission denied/i.test(message)) {
        await audit
          .emit({
            event_type: 'regulated_record_mutation_denied',
            acting_principal: actor.acting_principal,
            acting_persona: actor.acting_persona,
            scope_used: 'none',
            request_trace_id: actor.trace_id,
            request_body: { attempted_table: tableName, error: message.slice(0, 200) },
            response_status: 403
          })
          .catch(() => undefined) // the denial stands even if logging fails
      }
      throw e
    }
  }
}

export interface RetentionStatusRow {
  table_name: string
  hot_months: number
  immutable_months: number
  row_count: number
  due_for_warm_tier: number
  oldest_record_at: string | null
}

/** Per-table retention posture (Compliance View source; warm-tier mover lands with analytics). */
export async function retentionStatus(databaseUrl: string): Promise<RetentionStatusRow[]> {
  const pool = new pg.Pool({ connectionString: databaseUrl })
  try {
    const policies = await pool.query(`SELECT table_name, hot_months, immutable_months FROM retention_policy ORDER BY table_name`)
    const out: RetentionStatusRow[] = []
    for (const p of policies.rows) {
      const stats = await pool.query(
        `SELECT count(*)::int AS row_count,
                count(*) FILTER (WHERE created_at < now() - ($1 || ' months')::interval)::int AS due_for_warm_tier,
                min(created_at) AS oldest
         FROM ${p.table_name}`,
        [p.hot_months]
      )
      out.push({
        table_name: p.table_name,
        hot_months: p.hot_months,
        immutable_months: p.immutable_months,
        row_count: stats.rows[0].row_count,
        due_for_warm_tier: stats.rows[0].due_for_warm_tier,
        oldest_record_at: stats.rows[0].oldest ? new Date(stats.rows[0].oldest).toISOString() : null
      })
    }
    return out
  } finally {
    await pool.end()
  }
}
