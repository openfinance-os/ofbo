import type { StoredReconciliationRun, ReconciliationRunCreateInput, ReconciliationRunListQuery, ReconciliationRunPage } from '@ofbo/db'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import type { HighClassAuditSink } from '../high-class-audit.js'
import { runThreeWayReconciliation, type ReconResult, type ReconSources, type ReconWindow } from './engine.js'
import { buildSimReconSources, type SimReconConfig } from './sources.js'

/**
 * BACKOFFICE-01 — reconciliation run orchestration + read surface. Executes the
 * three-way match for a window, writes a reconciliation_log row (with BCBS 239
 * lineage via the store) and a reconciliation_run_completed High-class audit,
 * and exposes the runs to reconciliation:read consumers. The daily run is a
 * headless scheduled job (no public ingress) — run_id is derived from the date
 * so re-runs are idempotent (store ON CONFLICT). Break records are BACKOFFICE-02.
 */

export const RECON_READ_SCOPE = 'reconciliation:read'
const RUN_PRINCIPAL = 'system:reconciliation-engine'

export interface ReconciliationLogStore {
  create(input: ReconciliationRunCreateInput, traceId: string): Promise<{ run: StoredReconciliationRun; created: boolean }>
  get(runId: string): Promise<StoredReconciliationRun | null>
  list(query?: ReconciliationRunListQuery): Promise<ReconciliationRunPage>
}

/** A bundle of the three sources plus the open-dispute refs for the window. */
export type ReconSourcesBundle = ReconSources & { openDisputeRefs: Set<string> }

export interface ReconciliationDeps {
  store: ReconciliationLogStore
  audit: HighClassAuditSink
  /** Resolves the three sources for a period (defaults to the deterministic sim). */
  sourcesFor?: (period: string) => ReconSourcesBundle
  now?: () => Date
}

export interface ReconRunResult {
  run: StoredReconciliationRun
  created: boolean
  result: ReconResult
}

const pad = (n: number) => String(n).padStart(2, '0')
const dateKey = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

export class ReconciliationService {
  private readonly store: ReconciliationLogStore
  private readonly audit: HighClassAuditSink
  private readonly sourcesFor: (period: string) => ReconSourcesBundle
  private readonly now: () => Date

  constructor(deps: ReconciliationDeps) {
    this.store = deps.store
    this.audit = deps.audit
    this.sourcesFor = deps.sourcesFor ?? ((period: string) => buildSimReconSources(period))
    this.now = deps.now ?? (() => new Date())
  }

  /**
   * Execute the daily three-way reconciliation for a window (defaults to the UTC
   * day ending at `now`). Idempotent on the derived run_id. `simConfig` lets a
   * demo dial the injected variance/dispute counts.
   */
  async runDaily(traceId: string, opts: { window?: ReconWindow; runType?: string; simConfig?: SimReconConfig } = {}): Promise<ReconRunResult> {
    const end = opts.window ? new Date(opts.window.end) : this.now()
    const start = opts.window ? new Date(opts.window.start) : new Date(end.getTime() - 24 * 60 * 60 * 1000)
    const window: ReconWindow = { start: start.toISOString(), end: end.toISOString() }
    const runType = opts.runType ?? 'daily'
    const period = dateKey(start)
    const runId = `recon-${period}-${runType}`

    const bundle = opts.simConfig ? buildSimReconSources(period, opts.simConfig) : this.sourcesFor(period)
    const result = await runThreeWayReconciliation(bundle, window, { openDisputeRefs: bundle.openDisputeRefs })

    const { run, created } = await this.store.create(
      {
        run_id: runId,
        run_type: runType,
        status: 'completed',
        window_start: window.start,
        window_end: window.end,
        line_count_total: result.line_count_total,
        line_count_matched: result.line_count_matched,
        line_count_unmatched: result.line_count_unmatched,
        line_count_disputed: result.line_count_disputed
      },
      traceId
    )

    // Audit only an actually-executed run, not an idempotent no-op replay.
    if (created) {
      await this.audit.emit({
        event_type: 'reconciliation_run_completed',
        acting_principal: RUN_PRINCIPAL,
        acting_persona: 'system',
        scope_used: 'reconciliation:run',
        request_trace_id: traceId,
        request_body: {
          run_id: runId,
          run_type: runType,
          window,
          line_count_total: result.line_count_total,
          line_count_matched: result.line_count_matched,
          line_count_unmatched: result.line_count_unmatched,
          line_count_disputed: result.line_count_disputed
        },
        response_status: 200
      })
    }

    return { run, created, result }
  }

  async list(principal: Principal, query: ReconciliationRunListQuery = {}): Promise<ReconciliationRunPage> {
    assertScope(principal, RECON_READ_SCOPE)
    return this.store.list(query)
  }

  async getRun(principal: Principal, runId: string): Promise<StoredReconciliationRun | null> {
    assertScope(principal, RECON_READ_SCOPE)
    return this.store.get(runId)
  }
}

/** No-database default (tests / local dev). */
export class InMemoryReconciliationLogStore implements ReconciliationLogStore {
  private readonly rows: StoredReconciliationRun[] = []
  async create(input: ReconciliationRunCreateInput): Promise<{ run: StoredReconciliationRun; created: boolean }> {
    const existing = this.rows.find((r) => r.run_id === input.run_id)
    if (existing) return { run: existing, created: false }
    const run: StoredReconciliationRun = {
      id: crypto.randomUUID(),
      run_id: input.run_id,
      run_type: input.run_type,
      status: input.status,
      window_start: input.window_start,
      window_end: input.window_end,
      line_count_total: input.line_count_total ?? null,
      line_count_matched: input.line_count_matched ?? null,
      line_count_unmatched: input.line_count_unmatched ?? null,
      line_count_disputed: input.line_count_disputed ?? null,
      failure_reason: input.failure_reason ?? null,
      created_at: new Date().toISOString()
    }
    this.rows.unshift(run)
    return { run, created: true }
  }
  async get(runId: string): Promise<StoredReconciliationRun | null> {
    return this.rows.find((r) => r.run_id === runId) ?? null
  }
  async list(query: ReconciliationRunListQuery = {}): Promise<ReconciliationRunPage> {
    let rows = this.rows
    if (query.run_type) rows = rows.filter((r) => r.run_type === query.run_type)
    if (query.status) rows = rows.filter((r) => r.status === query.status)
    return { rows: rows.slice(0, Math.min(Math.max(query.limit ?? 50, 1), 200)), next_cursor: null }
  }
}
