import pg from 'pg'
import { beginAppTx, beginInternalViewTx } from './tenant-tx.js'

/**
 * BACKOFFICE-33 (ADR 0015) — the governed cross-fintech aggregation control. Reading the
 * aggregate MVs requires the SELECT-only `bank_internal_view` role, which bypasses per-tenant
 * RLS. That bypass is the platform's highest-sensitivity data path, so EVERY such read must:
 *   1. match a registered + approved purpose in `query_purpose_registry` (preventative — reject
 *      otherwise; the query never runs);
 *   2. run as `bank_internal_view` (cross-tenant), and
 *   3. be High-class logged (purpose_code + row count) — the durable evidence of the bypass.
 *
 * New purposes are added through the four-eyes flow (a later story); the BD-13 starter set is
 * seeded pre-approved via `seedQueryPurposes`.
 */

export class GovernedQueryError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'GovernedQueryError'
  }
}

/** Minimal High-class audit sink (structural match for @ofbo/db PgAuditEmitter.emit). */
export interface GovernedAuditSink {
  emit(event: {
    event_type: string
    acting_principal: string
    acting_persona: string
    scope_used: string
    request_trace_id: string
    request_body?: unknown
    response_status: number
  }): Promise<void>
}

export interface GovernedAggregateContext {
  pool: pg.Pool
  bankId: string
  /** purpose_code that must be registered + approved in query_purpose_registry. */
  purposeCode: string
  audit: GovernedAuditSink
  actingPrincipal: string
  actingPersona?: string
  scopeUsed?: string
  traceId: string
}

/** True iff `purposeCode` is registered AND approved for this bank (checked as ofbo_app under RLS). */
export async function isPurposeApproved(pool: pg.Pool, bankId: string, purposeCode: string): Promise<boolean> {
  const c = await pool.connect()
  try {
    await c.query(beginAppTx(bankId))
    const res = await c.query(
      `SELECT 1 FROM query_purpose_registry WHERE purpose_code = $1 AND approved_by IS NOT NULL LIMIT 1`,
      [purposeCode]
    )
    await c.query('COMMIT')
    return (res.rowCount ?? 0) > 0
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined)
    throw e
  } finally {
    c.release()
  }
}

/**
 * Run a cross-fintech aggregate under the governed control. Rejects (no DB read) if the purpose
 * is not registered+approved; otherwise runs `queryFn` as `bank_internal_view` and High-class
 * logs the bypass with the row count. `queryFn` returns the result plus the row count to log.
 */
export async function runGovernedAggregate<T>(
  ctx: GovernedAggregateContext,
  queryFn: (c: pg.PoolClient) => Promise<{ result: T; rowCount: number }>
): Promise<T> {
  if (!(await isPurposeApproved(ctx.pool, ctx.bankId, ctx.purposeCode))) {
    throw new GovernedQueryError(
      'BACKOFFICE.UNREGISTERED_QUERY_PURPOSE',
      `cross-fintech query purpose '${ctx.purposeCode}' is not registered+approved in query_purpose_registry`
    )
  }

  const c = await ctx.pool.connect()
  let out: { result: T; rowCount: number }
  try {
    await c.query(beginInternalViewTx())
    out = await queryFn(c)
    await c.query('COMMIT')
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined)
    throw e
  } finally {
    c.release()
  }

  // Durable evidence of the bypass (purpose + row count; both non-PII). Logged AFTER a clean read.
  await ctx.audit.emit({
    event_type: 'cross_fintech_query',
    acting_principal: ctx.actingPrincipal,
    acting_persona: ctx.actingPersona ?? 'system',
    scope_used: ctx.scopeUsed ?? ctx.purposeCode,
    request_trace_id: ctx.traceId,
    request_body: { purpose_code: ctx.purposeCode, row_count: out.rowCount },
    response_status: 200
  })

  return out.result
}

/**
 * BD-13 starter purpose set (ADR 0015) — seeded pre-approved. New purposes after this go through
 * the four-eyes registration flow (a later story).
 */
export const SEED_QUERY_PURPOSES: { purpose_code: string; description: string }[] = [
  { purpose_code: 'executive_dashboard', description: 'Cross-fintech executive commercial + programme KPIs (incl. onboarding funnel) — BACKOFFICE-27' },
  { purpose_code: 'finance_view', description: 'Cross-fintech fee accrual + TPP-aaS margin — BACKOFFICE-31' },
  { purpose_code: 'risk_monitoring', description: 'Platform-wide risk signals + liability monitor — BACKOFFICE-30' },
  { purpose_code: 'operations_monitoring', description: 'Platform health, certification pipeline, outages, recon SLO — BACKOFFICE-28' },
  { purpose_code: 'compliance_reporting', description: 'Consent volumes, retention posture, dispute/risk backlogs — BACKOFFICE-29' },
  { purpose_code: 'regulatory_periodic_report', description: 'CBUAE periodic cross-fintech regulatory report generation — BACKOFFICE-23/-35' }
]

/** Idempotently seed the BD-13 starter purpose set for a bank+channel (pre-approved). */
export async function seedQueryPurposes(
  pool: pg.Pool,
  bankId: string,
  channel: string,
  approvedBy = 'system:bd-13-seed'
): Promise<void> {
  const c = await pool.connect()
  try {
    await c.query(beginAppTx(bankId))
    for (const p of SEED_QUERY_PURPOSES) {
      await c.query(
        `INSERT INTO query_purpose_registry (bank_id, channel, purpose_code, description, registered_by, approved_by)
         VALUES ($1, $2, $3, $4, $5, $5)
         ON CONFLICT (bank_id, purpose_code) DO NOTHING`,
        [bankId, channel, p.purpose_code, p.description, approvedBy]
      )
    }
    await c.query('COMMIT')
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined)
    throw e
  } finally {
    c.release()
  }
}
