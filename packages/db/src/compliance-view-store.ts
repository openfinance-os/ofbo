import pg from 'pg'
import { beginAppTx } from './tenant-tx.js'
import { runGovernedAggregate, type GovernedAuditSink, type GovernedReadContext } from './governed-aggregate.js'

/**
 * BACKOFFICE-29 / BACKOFFICE-33 — Compliance View metrics. Read-only aggregates over existing
 * regulated tables (audit_high_sensitivity, dispute_case, risk_signal, compliance_report).
 * These are CROSS-FINTECH aggregates, so every read goes through the governed path
 * (`runGovernedAggregate`, purpose `compliance_reporting`): it runs as `bank_internal_view`
 * (RLS bypassed across tenants), is purpose-checked, and High-class logs the bypass query.
 * No writes, no PSU PII leaves the aggregate counts. Retention posture is sourced separately
 * from retentionStatus(); release-calendar gap is deferred to BACKOFFICE-39.
 */

const PURPOSE = 'compliance_reporting'

export interface ConsentVolumes {
  total: number
  by_event_type: Record<string, number>
}
export interface DisputeBacklog {
  open: number
  by_state: Record<string, number>
}
export interface RiskSignalBacklog {
  open: number
  by_severity: Record<string, number>
}
export interface ReportLibrary {
  by_status: Record<string, number>
  by_type: Record<string, number>
  recent_inquiries: { id: string; reporting_period_start: string; reporting_period_end: string; status: string; generated_at: string | null }[]
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v))
const tally = (rows: { k: string; n: string | number }[]): Record<string, number> =>
  rows.reduce<Record<string, number>>((acc, r) => ((acc[r.k] = Number(r.n)), acc), {})

export class PgComplianceMetricsStore {
  private readonly pool: pg.Pool
  constructor(
    databaseUrl: string,
    private readonly config: { bankId: string; channel: string },
    /** Required for the governed (cross-fintech) read path; absent for legacy single-tenant callers. */
    private readonly audit?: GovernedAuditSink
  ) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
  }

  /**
   * Run an aggregate read. With a per-request `ctx` (+ an injected audit sink) it goes through the
   * GOVERNED cross-fintech path (`bank_internal_view`, purpose `compliance_reporting`, High-class
   * logged) — BACKOFFICE-33. Without `ctx` it falls back to the single-tenant `ofbo_app` read used
   * by callers not yet migrated to the governed path (e.g. the executive dashboard).
   */
  private async read<T>(ctx: GovernedReadContext | undefined, fn: (c: pg.PoolClient) => Promise<{ result: T; rowCount: number }>): Promise<T> {
    if (ctx && this.audit) {
      return runGovernedAggregate({ pool: this.pool, bankId: this.config.bankId, purposeCode: PURPOSE, audit: this.audit, ...ctx }, fn)
    }
    const c = await this.pool.connect()
    try {
      await c.query(beginAppTx(this.config.bankId))
      const out = await fn(c)
      await c.query('COMMIT')
      return out.result
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined)
      throw e
    } finally {
      c.release()
    }
  }

  async consentVolumes(ctx?: GovernedReadContext): Promise<ConsentVolumes> {
    return this.read(ctx, async (c) => {
      const res = await c.query(
        `SELECT event_type AS k, count(*) AS n FROM audit_high_sensitivity
          WHERE event_type IN ('consent_granted','consent_accessed','consent_modified','consent_revoked')
          GROUP BY event_type`
      )
      const by = tally(res.rows)
      return { result: { total: Object.values(by).reduce((a, b) => a + b, 0), by_event_type: by }, rowCount: res.rowCount ?? 0 }
    })
  }

  async disputeBacklog(ctx?: GovernedReadContext): Promise<DisputeBacklog> {
    return this.read(ctx, async (c) => {
      const res = await c.query(`SELECT state AS k, count(*) AS n FROM dispute_case GROUP BY state`)
      const by = tally(res.rows)
      const open = Object.entries(by)
        .filter(([s]) => s !== 'resolved' && s !== 'closed')
        .reduce((a, [, n]) => a + n, 0)
      return { result: { open, by_state: by }, rowCount: res.rowCount ?? 0 }
    })
  }

  async riskSignalBacklog(ctx?: GovernedReadContext): Promise<RiskSignalBacklog> {
    return this.read(ctx, async (c) => {
      const res = await c.query(
        `SELECT severity AS k, count(*) AS n FROM risk_signal
          WHERE status NOT IN ('closed_actioned','closed_no_action','false_positive') GROUP BY severity`
      )
      const by = tally(res.rows)
      return { result: { open: Object.values(by).reduce((a, b) => a + b, 0), by_severity: by }, rowCount: res.rowCount ?? 0 }
    })
  }

  async reportLibrary(ctx?: GovernedReadContext): Promise<ReportLibrary> {
    return this.read(ctx, async (c) => {
      const [byStatus, byType, recent] = await Promise.all([
        c.query(`SELECT status AS k, count(*) AS n FROM compliance_report GROUP BY status`),
        c.query(`SELECT report_type AS k, count(*) AS n FROM compliance_report GROUP BY report_type`),
        c.query(
          `SELECT id, reporting_period_start, reporting_period_end, status, generated_at FROM compliance_report
            WHERE report_type LIKE '%inquiry%' ORDER BY created_at DESC LIMIT 10`
        )
      ])
      return {
        result: {
          by_status: tally(byStatus.rows),
          by_type: tally(byType.rows),
          recent_inquiries: recent.rows.map((r) => ({
            id: r.id as string,
            reporting_period_start: iso(r.reporting_period_start),
            reporting_period_end: iso(r.reporting_period_end),
            status: r.status as string,
            generated_at: r.generated_at ? iso(r.generated_at) : null
          }))
        },
        rowCount: (byStatus.rowCount ?? 0) + (byType.rowCount ?? 0) + (recent.rowCount ?? 0)
      }
    })
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
