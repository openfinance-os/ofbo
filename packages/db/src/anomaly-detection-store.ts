import pg from 'pg'
import { beginAppTx } from './tenant-tx.js'

/**
 * BACKOFFICE-37 — consent-pattern anomaly detection reads. RLS-bound windowed
 * aggregates over audit_high_sensitivity: consent churn per PSU (revoke+re-grant)
 * and PSU-lookup volume per agent. Also the open-signal dedup keys so the streaming
 * detector does not re-emit across scheduled runs. target_psu_identifier is the
 * internal bank_customer_id (not raw PSU PII); acting_principal is the agent subject.
 */

export interface ConsentChurnRow {
  psu_identifier: string
  revokes: number
  grants: number
  cycles: number
}
export interface AgentLookupRow {
  agent: string
  lookups: number
}

export class PgAnomalyDetectionStore {
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

  /** Per-PSU consent revoke / re-grant counts since `sinceIso` (cycles = min(revokes, grants)). */
  async consentChurnByPsu(sinceIso: string): Promise<ConsentChurnRow[]> {
    return this.asApp(async (c) => {
      const res = await c.query(
        `SELECT target_psu_identifier AS psu,
                count(*) FILTER (WHERE event_type = 'consent_revoked')::int AS revokes,
                count(*) FILTER (WHERE event_type = 'consent_granted')::int AS grants
           FROM audit_high_sensitivity
          WHERE target_psu_identifier IS NOT NULL AND created_at >= $1
            AND event_type IN ('consent_revoked','consent_granted')
          GROUP BY target_psu_identifier`,
        [sinceIso]
      )
      return res.rows.map((r) => {
        const revokes = Number(r.revokes)
        const grants = Number(r.grants)
        return { psu_identifier: r.psu as string, revokes, grants, cycles: Math.min(revokes, grants) }
      })
    })
  }

  /** Per-agent PSU-lookup (consent_search) counts since `sinceIso`. */
  async lookupCountByAgent(sinceIso: string): Promise<AgentLookupRow[]> {
    return this.asApp(async (c) => {
      const res = await c.query(
        `SELECT acting_principal AS agent, count(*)::int AS lookups
           FROM audit_high_sensitivity
          WHERE event_type = 'consent_search' AND created_at >= $1
          GROUP BY acting_principal`,
        [sinceIso]
      )
      return res.rows.map((r) => ({ agent: r.agent as string, lookups: Number(r.lookups) }))
    })
  }

  /** BACKOFFICE-46 — repeated authorization denials per agent since `sinceIso`. */
  async scopeDenialsByAgent(sinceIso: string): Promise<AgentLookupRow[]> {
    return this.asApp(async (c) => {
      const res = await c.query(
        `SELECT acting_principal AS agent, count(*)::int AS lookups
           FROM audit_high_sensitivity
          WHERE event_type = 'scope_denied' AND created_at >= $1
          GROUP BY acting_principal`,
        [sinceIso]
      )
      return res.rows.map((r) => ({ agent: r.agent as string, lookups: Number(r.lookups) }))
    })
  }

  /** BACKOFFICE-46 — off-hours admin activity per agent since `sinceIso` (outside
   *  06:00–18:00 UTC; admin-scope actions only; excludes system principals). */
  async offHoursAdminByAgent(sinceIso: string): Promise<AgentLookupRow[]> {
    return this.asApp(async (c) => {
      const res = await c.query(
        `SELECT acting_principal AS agent, count(*)::int AS lookups
           FROM audit_high_sensitivity
          WHERE created_at >= $1 AND scope_used LIKE '%admin%'
            AND acting_principal NOT LIKE 'system:%'
            AND (extract(hour FROM created_at AT TIME ZONE 'UTC') < 6 OR extract(hour FROM created_at AT TIME ZONE 'UTC') >= 18)
          GROUP BY acting_principal`,
        [sinceIso]
      )
      return res.rows.map((r) => ({ agent: r.agent as string, lookups: Number(r.lookups) }))
    })
  }

  /** BACKOFFICE-69 — CAAP registrations per device since `sinceIso` (the device is
   *  the acting principal on a caap_registered High-class event). */
  async caapRegistrationsByDevice(sinceIso: string): Promise<AgentLookupRow[]> {
    return this.asApp(async (c) => {
      const res = await c.query(
        `SELECT acting_principal AS agent, count(*)::int AS lookups
           FROM audit_high_sensitivity
          WHERE event_type = 'caap_registered' AND created_at >= $1
          GROUP BY acting_principal`,
        [sinceIso]
      )
      return res.rows.map((r) => ({ agent: r.agent as string, lookups: Number(r.lookups) }))
    })
  }

  /** Dedup keys of OPEN anomaly signals — so the detector does not re-emit. */
  async openAnomalyDedupKeys(): Promise<Set<string>> {
    return this.asApp(async (c) => {
      const res = await c.query(
        `SELECT signal_data->>'dedup_key' AS k FROM risk_signal
          WHERE signal_type IN ('consent_anomaly','agent_anomaly','tpp_behaviour')
            AND status NOT IN ('closed_actioned','closed_no_action','false_positive')
            AND signal_data->>'dedup_key' IS NOT NULL`
      )
      return new Set(res.rows.map((r) => r.k as string))
    })
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
