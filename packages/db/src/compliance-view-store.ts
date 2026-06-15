import pg from 'pg'

/**
 * BACKOFFICE-29 — Compliance View metrics. Read-only aggregates over existing
 * regulated tables (consent_admin_event, dispute_case, risk_signal, compliance_report),
 * all RLS-bound (read as ofbo_app with the tenancy context set). No writes, no PSU PII
 * leaves the aggregate counts. Retention posture is sourced separately from
 * retentionStatus(); release-calendar gap is deferred to BACKOFFICE-39.
 */

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
    private readonly config: { bankId: string; channel: string }
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

  async consentVolumes(): Promise<ConsentVolumes> {
    // Read the RLS-bound base table (ofbo_app, tenancy-scoped), not the
    // consent_admin_event MV — the MV is granted only to bank_internal_view. The
    // filter matches the MV's projection of consent lifecycle events.
    return this.asApp(async (c) => {
      const res = await c.query(
        `SELECT event_type AS k, count(*) AS n FROM audit_high_sensitivity
          WHERE event_type IN ('consent_granted','consent_accessed','consent_modified','consent_revoked')
          GROUP BY event_type`
      )
      const by = tally(res.rows)
      return { total: Object.values(by).reduce((a, b) => a + b, 0), by_event_type: by }
    })
  }

  async disputeBacklog(): Promise<DisputeBacklog> {
    return this.asApp(async (c) => {
      const res = await c.query(`SELECT state AS k, count(*) AS n FROM dispute_case GROUP BY state`)
      const by = tally(res.rows)
      const open = Object.entries(by)
        .filter(([s]) => s !== 'resolved' && s !== 'closed')
        .reduce((a, [, n]) => a + n, 0)
      return { open, by_state: by }
    })
  }

  async riskSignalBacklog(): Promise<RiskSignalBacklog> {
    return this.asApp(async (c) => {
      const res = await c.query(
        `SELECT severity AS k, count(*) AS n FROM risk_signal
          WHERE status NOT IN ('closed_actioned','closed_no_action','false_positive') GROUP BY severity`
      )
      const by = tally(res.rows)
      return { open: Object.values(by).reduce((a, b) => a + b, 0), by_severity: by }
    })
  }

  async reportLibrary(): Promise<ReportLibrary> {
    return this.asApp(async (c) => {
      const [byStatus, byType, recent] = await Promise.all([
        c.query(`SELECT status AS k, count(*) AS n FROM compliance_report GROUP BY status`),
        c.query(`SELECT report_type AS k, count(*) AS n FROM compliance_report GROUP BY report_type`),
        c.query(
          `SELECT id, reporting_period_start, reporting_period_end, status, generated_at FROM compliance_report
            WHERE report_type LIKE '%inquiry%' ORDER BY created_at DESC LIMIT 10`
        )
      ])
      return {
        by_status: tally(byStatus.rows),
        by_type: tally(byType.rows),
        recent_inquiries: recent.rows.map((r) => ({
          id: r.id as string,
          reporting_period_start: iso(r.reporting_period_start),
          reporting_period_end: iso(r.reporting_period_end),
          status: r.status as string,
          generated_at: r.generated_at ? iso(r.generated_at) : null
        }))
      }
    })
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
