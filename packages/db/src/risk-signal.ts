import pg from 'pg'
import { beginAppTx } from './tenant-tx.js'
import type { LineageSink } from './lineage.js'
import { runGovernedAggregate, type GovernedAuditSink, type GovernedReadContext } from './governed-aggregate.js'
import { keysetClause } from './keyset.js'

/** BACKOFFICE-33: the risk view's cross-fintech aggregate reads run under this governed purpose. */
const RISK_PURPOSE = 'risk_monitoring'

/**
 * BACKOFFICE-80: persists Risk View signals (risk_signal table) under the
 * constrained ofbo_app role — structural match for the BFF RiskSignalSink.
 * M1-LINEAGE-RISK-SIGNAL: emits column-level lineage at write time (BCBS 239),
 * exactly as the audit path does — best-effort, the regulated write never
 * depends on catalogue availability.
 */

export interface RiskSignalSinkEvent {
  signal_type: string
  severity: string
  acting_principal: string
  summary: string
  trace_id: string
  /** BACKOFFICE-36 — liability proximity ref (issue × liable party × AED). */
  nebras_liability_event_ref?: string
  client_id?: string
  /** BACKOFFICE-37 — cross-run dedup key for the streaming anomaly detector (in signal_data). */
  dedup_key?: string
  /** BACKOFFICE-37 — extra signal context (e.g. session_flagged), merged into signal_data. */
  context?: Record<string, unknown>
}

const RISK_SIGNAL_COLUMNS = ['bank_id', 'channel', 'signal_type', 'severity', 'status', 'signal_data', 'nebras_liability_event_ref']

export class PgRiskSignalEmitter {
  private readonly pool: pg.Pool
  constructor(
    databaseUrl: string,
    private readonly config: { bankId: string; channel: string },
    private readonly lineage?: LineageSink
  ) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
  }

  async record(event: RiskSignalSinkEvent): Promise<void> {
    await this.write(event, null)
  }

  /**
   * BACKOFFICE-80 — write the signal unless one with the same `dedup_key` already exists since
   * `sinceIso`; returns whether it wrote. This is what makes "once per super-admin session" hold on
   * the deployed BFF, which builds its app (and the guardrail's in-memory map) per request — so the
   * memory never saw a previous request, and every super-admin read wrote another open signal.
   *
   * A transaction-scoped advisory lock on the key serialises the check-then-insert: the dashboard's
   * first render fans out several requests at once, and without it each would see "none yet".
   *
   * `onFirst` runs under that lock, only when this call is the one that will write, and BEFORE the
   * insert: its result is merged into `signal_data`, and if it throws the transaction rolls back and
   * nothing is recorded. The super-admin guardrail raises its ITSM ticket here, so a durable "already
   * raised" can never exist for a session whose ticket failed.
   */
  async recordOnce(
    event: RiskSignalSinkEvent & { dedup_key: string },
    sinceIso: string,
    onFirst?: () => Promise<Record<string, unknown>>
  ): Promise<boolean> {
    return this.write(event, sinceIso, onFirst)
  }

  private async write(
    event: RiskSignalSinkEvent,
    dedupSince: string | null,
    onFirst?: () => Promise<Record<string, unknown>>
  ): Promise<boolean> {
    const c = await this.pool.connect()
    try {
      await c.query(beginAppTx(this.config.bankId))
      if (dedupSince !== null && event.dedup_key) {
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`risk_signal:${event.dedup_key}`])
        const seen = await c.query(
          `SELECT 1 FROM risk_signal
            WHERE signal_type = $1 AND signal_data->>'dedup_key' = $2 AND created_at >= $3
            LIMIT 1`,
          [event.signal_type, event.dedup_key, dedupSince]
        )
        if (seen.rowCount) {
          await c.query('COMMIT')
          return false
        }
      }
      const extra = onFirst ? await onFirst() : {}
      await c.query(
        `INSERT INTO risk_signal (bank_id, channel, signal_type, severity, status, client_id, signal_data, nebras_liability_event_ref)
         VALUES ($1, $2, $3, $4, 'open', $5, $6::jsonb, $7)`,
        [
          this.config.bankId,
          this.config.channel,
          event.signal_type,
          event.severity,
          event.client_id ?? null,
          JSON.stringify({ acting_principal: event.acting_principal, summary: event.summary, trace_id: event.trace_id, ...(event.dedup_key ? { dedup_key: event.dedup_key } : {}), ...(event.context ?? {}), ...extra }),
          event.nebras_liability_event_ref ?? null
        ]
      )
      await c.query('COMMIT')
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined)
      throw e
    } finally {
      c.release()
    }
    await this.emitLineage(event)
    return true
  }

  private async emitLineage(event: RiskSignalSinkEvent): Promise<void> {
    // BCBS 239 (M1-LINEAGE-RISK-SIGNAL): lineage at write time. Best-effort by
    // design — the regulated write itself never depends on catalogue availability.
    try {
      await this.lineage?.emitLineage({
        table: 'risk_signal',
        columns: RISK_SIGNAL_COLUMNS,
        source: 'bff-risk-signal-emitter',
        trace_id: event.trace_id
      })
    } catch {
      /* catalogue unavailable — write stands; Q4.5 surfaces persistent gaps */
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

/**
 * BACKOFFICE-30 — Risk View read aggregates over risk_signal. Read-only, RLS-bound
 * (ofbo_app + tenancy). Surfaces typed fields + counts only — never the raw
 * signal_data blob (the per-signal context lives behind the risk-signals detail
 * endpoint). "Active" = not in a closed/false-positive terminal state.
 */
export interface RiskSignalSummary {
  active_total: number
  by_type: Record<string, number>
  by_severity: Record<string, number>
  by_status: Record<string, number>
}
export interface LiabilityMonitor {
  open_count: number
  by_severity: Record<string, number>
  recent: { nebras_liability_event_ref: string | null; severity: string; created_at: string }[]
}
export interface RiskSignalHeader {
  id: string
  signal_type: string
  severity: string
  status: string
  client_id: string | null
  nebras_liability_event_ref: string | null
  created_at: string
}

/** BACKOFFICE-30/-42 — full risk_signal row for the list/triage surface. */
export interface StoredRiskSignal {
  id: string
  signal_type: string
  severity: string
  status: string
  client_id: string | null
  channel: string
  signal_data: Record<string, unknown>
  nebras_liability_event_ref: string | null
  created_at: string
}
export interface RiskSignalListQuery {
  cursor?: string
  limit?: number
  signal_type?: string
  severity?: string
  status?: string
}
export interface RiskSignalPage {
  rows: StoredRiskSignal[]
  next_cursor: string | null
}

const ACTIVE = `status NOT IN ('closed_actioned','closed_no_action','false_positive')`
const isoR = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v))
const tallyR = (rows: { k: string; n: string | number }[]): Record<string, number> =>
  rows.reduce<Record<string, number>>((acc, r) => ((acc[r.k] = Number(r.n)), acc), {})

export class PgRiskMetricsStore {
  private readonly pool: pg.Pool
  constructor(
    databaseUrl: string,
    private readonly config: { bankId: string; channel: string },
    /** Required for the governed (cross-fintech) read path; absent for legacy single-tenant callers. */
    private readonly audit?: GovernedAuditSink
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

  /**
   * BACKOFFICE-33: an aggregate read. With a per-request `ctx` (+ injected audit sink) it goes
   * through the GOVERNED cross-fintech path (`bank_internal_view`, purpose `risk_monitoring`,
   * High-class logged); without `ctx` it falls back to the single-tenant `ofbo_app` read (used by
   * the liability service + the scheduled monitor, which are not migrated to the governed path).
   */
  private async readGoverned<T>(ctx: GovernedReadContext | undefined, fn: (c: pg.PoolClient) => Promise<{ result: T; rowCount: number }>): Promise<T> {
    if (ctx && this.audit) {
      // Risk reads are always logged under risk_monitoring — purposeCode last so a caller's ctx
      // can never relabel this store's bypass provenance.
      return runGovernedAggregate({ pool: this.pool, bankId: this.config.bankId, audit: this.audit, ...ctx, purposeCode: RISK_PURPOSE }, fn)
    }
    return this.asApp(async (c) => (await fn(c)).result)
  }

  async summary(ctx?: GovernedReadContext): Promise<RiskSignalSummary> {
    return this.readGoverned(ctx, async (c) => {
      const [byType, bySeverity, byStatus] = await Promise.all([
        c.query(`SELECT signal_type AS k, count(*) AS n FROM risk_signal WHERE ${ACTIVE} GROUP BY signal_type`),
        c.query(`SELECT severity AS k, count(*) AS n FROM risk_signal WHERE ${ACTIVE} GROUP BY severity`),
        c.query(`SELECT status AS k, count(*) AS n FROM risk_signal GROUP BY status`)
      ])
      const byT = tallyR(byType.rows)
      return {
        result: { active_total: Object.values(byT).reduce((a, b) => a + b, 0), by_type: byT, by_severity: tallyR(bySeverity.rows), by_status: tallyR(byStatus.rows) },
        rowCount: (byType.rowCount ?? 0) + (bySeverity.rowCount ?? 0) + (byStatus.rowCount ?? 0)
      }
    })
  }

  async liabilityMonitor(ctx?: GovernedReadContext): Promise<LiabilityMonitor> {
    return this.readGoverned(ctx, async (c) => {
      const [bySeverity, recent] = await Promise.all([
        c.query(`SELECT severity AS k, count(*) AS n FROM risk_signal WHERE signal_type = 'nebras_liability_approach' AND ${ACTIVE} GROUP BY severity`),
        c.query(`SELECT nebras_liability_event_ref, severity, created_at FROM risk_signal WHERE signal_type = 'nebras_liability_approach' AND ${ACTIVE} ORDER BY created_at DESC LIMIT 10`)
      ])
      const by = tallyR(bySeverity.rows)
      return {
        result: {
          open_count: Object.values(by).reduce((a, b) => a + b, 0),
          by_severity: by,
          recent: recent.rows.map((r) => ({ nebras_liability_event_ref: (r.nebras_liability_event_ref as string) ?? null, severity: r.severity as string, created_at: isoR(r.created_at) }))
        },
        rowCount: (bySeverity.rowCount ?? 0) + (recent.rowCount ?? 0)
      }
    })
  }

  async recentActive(limit = 20): Promise<RiskSignalHeader[]> {
    const n = Math.min(Math.max(limit, 1), 100)
    return this.asApp(async (c) => {
      const res = await c.query(
        `SELECT id, signal_type, severity, status, client_id, nebras_liability_event_ref, created_at
           FROM risk_signal WHERE ${ACTIVE} ORDER BY created_at DESC LIMIT ${n}`
      )
      return res.rows.map((r) => ({
        id: r.id as string,
        signal_type: r.signal_type as string,
        severity: r.severity as string,
        status: r.status as string,
        client_id: (r.client_id as string) ?? null,
        nebras_liability_event_ref: (r.nebras_liability_event_ref as string) ?? null,
        created_at: isoR(r.created_at)
      }))
    })
  }

  /** BACKOFFICE-30 — paginated signal list with optional type/severity/status filters. */
  async listSignals(query: RiskSignalListQuery = {}): Promise<RiskSignalPage> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
    const after = query.cursor ? decodeSignalCursor(query.cursor) : null
    const rows = await this.asApp(async (c) => {
      const params: unknown[] = []
      const where: string[] = []
      for (const [col, val] of [['signal_type', query.signal_type], ['severity', query.severity], ['status', query.status]] as const) {
        if (val) {
          params.push(val)
          where.push(`${col} = $${params.length}`)
        }
      }
      if (after) {
        where.push(keysetClause(params, after, { direction: 'desc' }))
      }
      const res = await c.query(
        `SELECT id, signal_type, severity, status, client_id, channel, signal_data, nebras_liability_event_ref, created_at
           FROM risk_signal ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY date_trunc('milliseconds', created_at) DESC, id DESC
           LIMIT ${limit + 1}`,
        params
      )
      return res.rows
    })
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const last = page[page.length - 1] as Record<string, unknown> | undefined
    return {
      rows: page.map(toSignalRecord),
      next_cursor: hasMore && last ? encodeSignalCursor(isoR(last.created_at), last.id as string) : null
    }
  }

  async getSignal(id: string): Promise<StoredRiskSignal | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `SELECT id, signal_type, severity, status, client_id, channel, signal_data, nebras_liability_event_ref, created_at FROM risk_signal WHERE id = $1`,
        [id]
      )
      return res.rows[0] ?? null
    })
    return row ? toSignalRecord(row) : null
  }

  /** BACKOFFICE-42 — signal triage state transition (acknowledge / investigate / close). */
  async updateSignalStatus(id: string, status: string): Promise<StoredRiskSignal | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `UPDATE risk_signal SET status = $2 WHERE id = $1
         RETURNING id, signal_type, severity, status, client_id, channel, signal_data, nebras_liability_event_ref, created_at`,
        [id, status]
      )
      return res.rows[0] ?? null
    })
    return row ? toSignalRecord(row) : null
  }

  /**
   * BACKOFFICE-80 — the transition, applied only if the signal is still in `from`. The backlog job
   * reads candidates and then closes them; an analyst may triage one in between, and a blind
   * `SET status` would overwrite their decision and audit a `from_status` that was no longer true.
   */
  async transitionSignalStatus(id: string, from: string, to: string): Promise<StoredRiskSignal | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `UPDATE risk_signal SET status = $3 WHERE id = $1 AND status = $2
         RETURNING id, signal_type, severity, status, client_id, channel, signal_data, nebras_liability_event_ref, created_at`,
        [id, from, to]
      )
      return res.rows[0] ?? null
    })
    return row ? toSignalRecord(row) : null
  }

  /**
   * BACKOFFICE-80 — open "super-admin session active" signals written BEFORE the durable dedupe
   * (no `dedup_key`) that are not the earliest for their principal within an 8-hour bucket, the
   * guardrail's session window. Oldest first, bounded, so a scheduled job can drain them in batches.
   */
  async duplicateSuperAdminSessionSignalIds(limit: number): Promise<string[]> {
    return this.asApp(async (c) => {
      const res = await c.query(
        `SELECT id FROM (
           SELECT id, created_at,
                  row_number() OVER (
                    PARTITION BY signal_data->>'acting_principal', floor(extract(epoch FROM created_at) / 28800)
                    ORDER BY created_at, id
                  ) AS rn
             FROM risk_signal
            WHERE signal_type = 'agent_anomaly'
              AND severity = 'info'
              AND status = 'open'
              AND signal_data->>'summary' = 'super-admin session active'
              AND signal_data->>'dedup_key' IS NULL
         ) ranked
         WHERE rn > 1
         ORDER BY created_at, id
         LIMIT $1`,
        [Math.min(Math.max(limit, 1), 500)]
      )
      return res.rows.map((r) => r.id as string)
    })
  }

  /**
   * Dedup keys of OPEN signals of one type — what a daily monitor checks so it does not raise the
   * same unresolved condition again every run (BACKOFFICE-67's cadence monitor did: 16 a day).
   */
  async openDedupKeys(signalType: string): Promise<Set<string>> {
    return this.asApp(async (c) => {
      const res = await c.query(
        `SELECT DISTINCT signal_data->>'dedup_key' AS k FROM risk_signal
          WHERE signal_type = $1 AND status = 'open' AND signal_data->>'dedup_key' IS NOT NULL`,
        [signalType]
      )
      return new Set(res.rows.map((r) => r.k as string))
    })
  }

  /**
   * OPEN signals of one type superseded by a newer open signal with the same dedup key — the
   * repeats a monitor wrote before it deduped. The newest per key stays open (it carries the most
   * recent summary). Oldest first, bounded, for a batch job.
   */
  async supersededOpenSignalIds(signalType: string, limit: number): Promise<string[]> {
    return this.asApp(async (c) => {
      const res = await c.query(
        `SELECT id FROM (
           SELECT id, created_at,
                  row_number() OVER (PARTITION BY signal_data->>'dedup_key' ORDER BY created_at DESC, id DESC) AS rn
             FROM risk_signal
            WHERE signal_type = $1 AND status = 'open' AND signal_data->>'dedup_key' IS NOT NULL
         ) ranked
         WHERE rn > 1
         ORDER BY created_at, id
         LIMIT $2`,
        [signalType, Math.min(Math.max(limit, 1), 500)]
      )
      return res.rows.map((r) => r.id as string)
    })
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

function toSignalRecord(r: Record<string, unknown>): StoredRiskSignal {
  return {
    id: r.id as string,
    signal_type: r.signal_type as string,
    severity: r.severity as string,
    status: r.status as string,
    client_id: (r.client_id as string) ?? null,
    channel: r.channel as string,
    signal_data: (r.signal_data as Record<string, unknown>) ?? {},
    nebras_liability_event_ref: (r.nebras_liability_event_ref as string) ?? null,
    created_at: isoR(r.created_at)
  }
}
/**
 * The risk-signal keyset cursor codec — EXPORTED so both adapters behind this port share one format.
 *
 * The in-memory store previously returned `next_cursor: null` unconditionally, so the two
 * implementations behind `GET /back-office/risk-signals` disagreed about whether the endpoint was
 * paginated at all: the Postgres one honoured `limit` and emitted cursors, the in-memory one
 * returned every matching row. A client that follows the cursor is correct against one and a no-op
 * against the other, which is exactly the port-parity rule — an adapter must pass the tests its
 * sibling passes.
 *
 * One codec rather than two, because two encodings that agree today are a format that diverges
 * later, and a cursor minted by one adapter must be readable by the other for the swap to mean
 * anything.
 */
export const encodeSignalCursor = (createdAt: string, id: string) => Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url')
export function decodeSignalCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
    return createdAt && id ? { createdAt, id } : null
  } catch {
    return null
  }
}
