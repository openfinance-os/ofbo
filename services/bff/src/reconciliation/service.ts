import type {
  StoredReconciliationRun,
  ReconciliationRunCreateInput,
  ReconciliationRunListQuery,
  ReconciliationRunPage,
  StoredReconciliationBreak,
  ReconciliationBreakCreateInput,
  ReconciliationBreakListQuery,
  ReconciliationBreakPage,
  ComplianceReportCreateInput,
  StoredComplianceReport
} from '@ofbo/db'
import { createHash } from 'node:crypto'
import type { ApmPort, ItsmPort, NebrasEgressPort, OtelSpan } from '@ofbo/ports'
import { redactPii, redactText } from '@ofbo/redaction'
import type { Principal } from '../auth.js'
import { assertScope, hasScope, ScopeDeniedError } from '../rbac.js'
import type { HighClassAuditSink } from '../high-class-audit.js'
import type { ApprovalRecord, GatedOperation } from '../approvals/service.js'
import { runThreeWayReconciliation, type ReconLineResult, type ReconResult, type ReconSources, type ReconWindow } from './engine.js'
import { buildSimReconSources, type SimReconConfig } from './sources.js'
import { computeTppAasMargin, emptyMargin, mergeMargin, type MarginSummary } from './margin.js'
import { detectBreaks, type DetectedBreak } from './breaks.js'
import { DEFAULT_THRESHOLDS, type BreakThreshold } from './thresholds.js'

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
  countForPrefix(runIdPrefix: string): Promise<number>
  listForPrefix(runIdPrefix: string): Promise<StoredReconciliationRun[]>
  listForRange(start: string, end: string): Promise<StoredReconciliationRun[]>
  list(query?: ReconciliationRunListQuery): Promise<ReconciliationRunPage>
}

export interface ReconciliationBreakStore {
  createMany(inputs: ReconciliationBreakCreateInput[], traceId: string): Promise<StoredReconciliationBreak[]>
  countForRun(runId: string): Promise<number>
  get(id: string): Promise<StoredReconciliationBreak | null>
  claim(id: string, assignedTo: string, traceId: string): Promise<StoredReconciliationBreak | null>
  resolve(id: string, outcome: string, note: string, traceId: string): Promise<StoredReconciliationBreak | null>
  reopen(id: string, traceId: string): Promise<StoredReconciliationBreak | null>
  escalateNebras(id: string, nebrasCaseId: string, traceId: string): Promise<StoredReconciliationBreak | null>
  summarizeByStatus(runIdPrefix: string): Promise<Record<string, number>>
  listForRange(start: string, end: string): Promise<StoredReconciliationBreak[]>
  list(query?: ReconciliationBreakListQuery): Promise<ReconciliationBreakPage>
}

/** BACKOFFICE-06 — compliance_report sink for the monthly sign-off (create + lineage). */
export interface MonthlyReportStore {
  create(input: ComplianceReportCreateInput, traceId: string): Promise<StoredComplianceReport>
}

export const RECON_WRITE_SCOPE = 'finance:reconciliation:write'
export const OPS_WRITE_SCOPE = 'platform:operations:write'
export const DISPUTES_WRITE_SCOPE = 'finance:disputes:write'
export const MONTHLY_REPORT_TYPE = 'monthly_reconciliation'
export const CBUAE_EXPORT_REPORT_TYPE = 'cbuae_reconciliation_export'
export const COMPLIANCE_GENERATE_SCOPE = 'compliance:reports:generate'
const lineHash = (line: unknown): string => createHash('sha256').update(canonicalJson(line)).digest('hex')
const OPEN_STATUSES = ['flagged', 'assigned']
const RESOLVED_STATUSES = ['resolved_matched', 'resolved_internal_correction']
const ESCALATED_STATUSES = ['escalated_nebras_dispute', 'escalated_fintech_billing']

/** Deterministic JSON for hashing (sorted keys). */
function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown =>
    v === null || typeof v !== 'object'
      ? v
      : Array.isArray(v)
        ? v.map(norm)
        : Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])]))
  return JSON.stringify(norm(value))
}
export const COMPLIANCE_SCOPE = 'audit:read'
export const BREAK_REOPEN_OPERATION = 'reconciliation.break_reopen'
export const MONTHLY_SIGNOFF_OPERATION = 'reconciliation.monthly_signoff'
/** Resolve outcomes accepted by the resolve endpoint (escalated_nebras_dispute is
 *  the separate escalate-nebras flow, BACKOFFICE-05). */
export const RESOLVE_OUTCOMES = ['resolved_matched', 'resolved_internal_correction', 'escalated_fintech_billing'] as const
const TERMINAL_STATUSES = new Set(['resolved_matched', 'resolved_internal_correction', 'escalated_nebras_dispute', 'escalated_fintech_billing'])
const MIN_NOTE = 20

export interface ReopenApprovalRequester {
  requestApproval(
    principal: Principal,
    input: { operation_type: string; operation_payload: Record<string, unknown> },
    traceId: string
  ): Promise<ApprovalRecord>
}

/** BACKOFFICE-04 — the four-eyes reopen operation. A different audit:read
 *  principal approves before a resolved break is reopened. */
export function makeBreakReopenOperation(deps: { breakStore: ReconciliationBreakStore; audit: HighClassAuditSink }): GatedOperation {
  return {
    initiatorScope: COMPLIANCE_SCOPE,
    approverScope: COMPLIANCE_SCOPE,
    execute: async (payload) => {
      const breakId = String(payload.break_id)
      const traceId = String(payload.trace_id ?? 'unknown')
      const initiatedBy = String(payload.initiated_by ?? 'unknown')
      const initiatedByPersona = String(payload.initiated_by_persona ?? 'unknown')
      const justification = String(payload.justification ?? '')
      const reopened = await deps.breakStore.reopen(breakId, traceId)
      await deps.audit.emit({
        event_type: 'reconciliation_break_reopened',
        acting_principal: initiatedBy,
        acting_persona: initiatedByPersona,
        scope_used: COMPLIANCE_SCOPE,
        request_trace_id: traceId,
        request_body: { break_id: breakId, justification, reopened: !!reopened, reopened_count: reopened?.reopened_count ?? null, four_eyes_approved: true },
        response_status: 200
      })
      return { break_id: breakId, status: reopened?.status ?? 'unchanged', reopened: !!reopened, reopened_count: reopened?.reopened_count ?? null }
    }
  }
}

/** BACKOFFICE-06 — the four-eyes monthly reconciliation sign-off operation; executes on
 *  approval (a different finance:reconciliation:write principal approves the initiator's
 *  request, then the report is generated + locked). Late-bound to the service to break the
 *  request↔execute cycle: the service REQUESTS the approval; this EXECUTES it. The signed
 *  report is attested to the INITIATOR (payload.initiated_by). */
export function makeMonthlySignoffOperation(deps: { execute: (period: string, attestedBy: string, attestedByPersona: string, traceId: string) => Promise<StoredComplianceReport> }): GatedOperation {
  return {
    initiatorScope: RECON_WRITE_SCOPE,
    approverScope: RECON_WRITE_SCOPE,
    execute: async (payload) =>
      deps.execute(
        String(payload.period),
        String(payload.initiated_by ?? 'unknown'),
        String(payload.initiated_by_persona ?? 'unknown'),
        String(payload.trace_id ?? 'unknown')
      )
  }
}

export class BreakWorkflowError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

/** P3 ITSM teams a break routes to (PRD §7.1 BACKOFFICE-02). */
const TEAM_ROUTE: Record<DetectedBreak['notify_team'], string> = {
  finance: 'finance',
  operations: 'payment_operations'
}

/** A bundle of the three sources plus the open-dispute refs for the window. */
export type ReconSourcesBundle = ReconSources & { openDisputeRefs: Set<string> }

export interface ReconciliationDeps {
  store: ReconciliationLogStore
  audit: HighClassAuditSink
  /** Resolves the three sources for a period (defaults to the deterministic sim). */
  sourcesFor?: (period: string) => ReconSourcesBundle
  /** BACKOFFICE-02 — break detection + team notification (omit to skip detection). */
  breakStore?: ReconciliationBreakStore
  itsm?: Pick<ItsmPort, 'createTicket'>
  thresholds?: BreakThreshold[]
  /** BACKOFFICE-12 — persisted configurable thresholds (omit → static defaults). */
  thresholdStore?: ThresholdStore
  /** BACKOFFICE-04 — four-eyes reopen initiation (omit to disable reopen). */
  approvals?: ReopenApprovalRequester
  /** BACKOFFICE-05 — P6 egress for Nebras dispute-case creation (omit to disable escalate). */
  egress?: Pick<NebrasEgressPort, 'createDisputeCase'>
  /** BACKOFFICE-13 — P5 APM sink for per-run/per-line OTel spans (omit to skip). */
  apm?: Pick<ApmPort, 'exportSpans'>
  /** BACKOFFICE-06 — compliance_report sink for the monthly sign-off (omit to disable). */
  reports?: MonthlyReportStore
  now?: () => Date
}

/** BACKOFFICE-12 — persisted per-fee-class break thresholds. The engine reads the
 *  current set at run time so edits take effect next run, never retroactively. */
export interface ThresholdStore {
  list(): Promise<BreakThreshold[]>
  replaceAll(thresholds: BreakThreshold[], updatedBy: string, traceId: string): Promise<BreakThreshold[]>
}

export interface ReconRunResult {
  run: StoredReconciliationRun
  created: boolean
  result: ReconResult
  breaks: StoredReconciliationBreak[]
  margin: MarginSummary
}

const pad = (n: number) => String(n).padStart(2, '0')
const dateKey = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

export class ReconciliationService {
  private readonly store: ReconciliationLogStore
  private readonly audit: HighClassAuditSink
  private readonly sourcesFor: (period: string) => ReconSourcesBundle
  private readonly breakStore?: ReconciliationBreakStore
  private readonly itsm?: Pick<ItsmPort, 'createTicket'>
  private readonly thresholds: BreakThreshold[]
  private readonly thresholdStore?: ThresholdStore
  private readonly approvals?: ReopenApprovalRequester
  private readonly egress?: Pick<NebrasEgressPort, 'createDisputeCase'>
  private readonly apm?: Pick<ApmPort, 'exportSpans'>
  private readonly reports?: MonthlyReportStore
  private readonly now: () => Date

  constructor(deps: ReconciliationDeps) {
    this.store = deps.store
    this.audit = deps.audit
    this.sourcesFor = deps.sourcesFor ?? ((period: string) => buildSimReconSources(period))
    this.breakStore = deps.breakStore
    this.itsm = deps.itsm
    this.thresholds = deps.thresholds ?? DEFAULT_THRESHOLDS
    this.thresholdStore = deps.thresholdStore
    this.approvals = deps.approvals
    this.egress = deps.egress
    this.apm = deps.apm
    this.reports = deps.reports
    this.now = deps.now ?? (() => new Date())
  }

  /**
   * Execute the daily three-way reconciliation for a window (defaults to the UTC
   * day ending at `now`). Idempotent on the derived run_id. `simConfig` lets a
   * demo dial the injected variance/dispute counts.
   */
  async runDaily(traceId: string, opts: { window?: ReconWindow; runType?: string; simConfig?: SimReconConfig; runId?: string } = {}): Promise<ReconRunResult> {
    const end = opts.window ? new Date(opts.window.end) : this.now()
    const start = opts.window ? new Date(opts.window.start) : new Date(end.getTime() - 24 * 60 * 60 * 1000)
    const window: ReconWindow = { start: start.toISOString(), end: end.toISOString() }
    const runType = opts.runType ?? 'daily'
    const period = dateKey(start)
    const runId = opts.runId ?? `recon-${period}-${runType}`

    const spanStart = this.now().getTime()
    const bundle = opts.simConfig ? buildSimReconSources(period, opts.simConfig) : this.sourcesFor(period)
    const result = await runThreeWayReconciliation(bundle, window, { openDisputeRefs: bundle.openDisputeRefs })
    // BACKOFFICE-07 — TPP-aaS margin for the run (Nebras fee ↔ fintech re-bill).
    const margin = await this.marginFor(bundle, window)

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
          line_count_disputed: result.line_count_disputed,
          tpp_aas_margin: margin.total_margin
        },
        response_status: 200
      })
    }

    // BACKOFFICE-02 — break detection. Only on an actually-executed run, and
    // only once per run_id (a re-run that already has breaks is a no-op).
    const breaks = created ? await this.detectAndRecordBreaks(runId, result, traceId) : []

    // BACKOFFICE-13 — OTel: one run span + one span per reconciled line.
    if (created) this.emitRunSpans(runId, runType, result, traceId, spanStart, margin.total_margin)

    return { run, created, result, breaks, margin }
  }

  /**
   * BACKOFFICE-10 — replay reconciliation over a date range from the buffered
   * source data (for a missed/failed daily run). Idempotent: the run_id is derived
   * from the window, so a repeat replay of an unchanged window is a no-op — the
   * store ON CONFLICT returns the existing run, and break detection / the run-
   * completion audit only fire on an actually-executed run (BACKOFFICE-01). The
   * sim sources are deterministic per period, so an unchanged window always
   * reproduces the same run. platform:operations:write; the human initiator is
   * High-class audited here (the system run-completion audit is separate).
   */
  async replay(principal: Principal, window: { start: string; end: string }, traceId: string): Promise<{ run: StoredReconciliationRun; created: boolean }> {
    assertScope(principal, OPS_WRITE_SCOPE)
    const start = new Date(window.start)
    const end = new Date(window.end)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BreakWorkflowError('BACKOFFICE.INVALID_WINDOW', 'window_start and window_end must be valid ISO timestamps.', 400)
    }
    if (end.getTime() <= start.getTime()) {
      throw new BreakWorkflowError('BACKOFFICE.INVALID_WINDOW', 'window_end must be after window_start.', 400)
    }
    const runId = `recon-replay-${dateKey(start)}_${dateKey(end)}`
    const { run, created } = await this.runDaily(traceId, { window: { start: start.toISOString(), end: end.toISOString() }, runType: 'replay', runId })
    await this.audit.emit({
      event_type: 'reconciliation_replay_requested',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: OPS_WRITE_SCOPE,
      request_trace_id: traceId,
      request_body: { window: { start: start.toISOString(), end: end.toISOString() }, run_id: run.run_id, idempotent_noop: !created },
      response_status: 202
    })
    return { run, created }
  }

  /** BACKOFFICE-07 — fetch the three sources for a window and compute the run's
   *  TPP-aaS margin (per fintech + product family). */
  private async marginFor(bundle: ReconSourcesBundle, window: ReconWindow): Promise<MarginSummary> {
    const [nebras, fintech, platform] = await Promise.all([bundle.nebras.fetch(window), bundle.fintech.fetch(window), bundle.platform.fetch(window)])
    return computeTppAasMargin({ nebras, fintech, platform })
  }

  /**
   * BACKOFFICE-13 — emit a parent run span plus one child span per reconciled
   * line, exported via the P5 APM bridge (OTel is the canonical stream; never a
   * second instrumentation path). Span attributes carry run_id, line_type, the
   * three source refs, the variance and the decision. Telemetry never fails a run.
   */
  private emitRunSpans(runId: string, runType: string, result: ReconResult, traceId: string, startMs: number, marginTotal: number): void {
    if (!this.apm) return
    const trace = redactText(traceId)
    const endMs = this.now().getTime()
    const runSpanId = crypto.randomUUID()
    const runSpan: OtelSpan = {
      name: 'reconciliation.run',
      trace_id: trace,
      span_id: runSpanId,
      start_time: startMs,
      end_time: endMs,
      status_code: 'ok',
      attributes: {
        'recon.run_id': runId,
        'recon.run_type': runType,
        'recon.line_count_total': result.line_count_total,
        'recon.line_count_matched': result.line_count_matched,
        'recon.line_count_unmatched': result.line_count_unmatched,
        'recon.line_count_disputed': result.line_count_disputed,
        'recon.tpp_aas_margin': marginTotal
      }
    }
    const lineSpan = (line: ReconLineResult): OtelSpan => ({
      name: 'reconciliation.line',
      trace_id: trace,
      span_id: crypto.randomUUID(),
      parent_span_id: runSpanId,
      start_time: startMs,
      end_time: endMs,
      status_code: 'ok',
      attributes: {
        'recon.run_id': runId,
        'recon.line_type': line.line_type,
        'recon.source_a_ref': line.source_a_ref, // Nebras
        'recon.source_b_ref': line.source_b_ref, // platform log
        'recon.source_c_ref': line.source_c_ref ?? '', // fintech billing
        'recon.variance_amount': line.variance?.amount ?? 0,
        'recon.decision': line.classification
      }
    })
    const spans: OtelSpan[] = [runSpan, ...result.lines.map(lineSpan)]
    // fire-and-forget: a P5 sink outage must never take a reconciliation run down
    void Promise.resolve(this.apm.exportSpans(spans)).catch(() => undefined)
  }

  /**
   * BACKOFFICE-12 — the effective threshold set: stored overrides (per fee class)
   * overlaid on the engine defaults, so every class always resolves. Read at run
   * time so a threshold edit takes effect on the next run, never retroactively.
   */
  private async effectiveThresholds(): Promise<BreakThreshold[]> {
    const stored = this.thresholdStore ? await this.thresholdStore.list() : []
    if (stored.length === 0) return this.thresholds
    const byClass = new Map(this.thresholds.map((t) => [t.fee_class, t]))
    for (const s of stored) byClass.set(s.fee_class, s)
    return [...byClass.values()]
  }

  private async detectAndRecordBreaks(runId: string, result: ReconResult, traceId: string): Promise<StoredReconciliationBreak[]> {
    if (!this.breakStore) return []
    if ((await this.breakStore.countForRun(runId)) > 0) return [] // already detected for this run
    const detected = detectBreaks(result, await this.effectiveThresholds())
    if (detected.length === 0) return []

    const inputs: ReconciliationBreakCreateInput[] = detected.map((b) => ({
      run_id: runId,
      client_id: b.client_id,
      line_type: b.line_type,
      variance_amount: b.variance_amount,
      variance_count: b.variance_count,
      source_a_ref: b.source_a_ref,
      source_b_ref: b.source_b_ref,
      source_c_ref: b.source_c_ref
    }))
    const stored = await this.breakStore.createMany(inputs, traceId)

    // Route notifications: Finance for fee breaks, Operations for consent breaks.
    const byTeam = new Map<DetectedBreak['notify_team'], number>()
    for (const b of detected) byTeam.set(b.notify_team, (byTeam.get(b.notify_team) ?? 0) + 1)
    for (const [team, count] of byTeam) {
      await this.itsm?.createTicket(
        { type: 'reconciliation_break', severity: 'medium', team: TEAM_ROUTE[team], summary: `${count} ${team} reconciliation break(s) in run ${runId}` },
        { trace_id: traceId }
      )
    }

    await this.audit.emit({
      event_type: 'reconciliation_breaks_detected',
      acting_principal: RUN_PRINCIPAL,
      acting_persona: 'system',
      scope_used: 'reconciliation:run',
      request_trace_id: traceId,
      request_body: {
        run_id: runId,
        break_count: detected.length,
        finance_breaks: byTeam.get('finance') ?? 0,
        operations_breaks: byTeam.get('operations') ?? 0
      },
      response_status: 200
    })
    return stored
  }

  async list(principal: Principal, query: ReconciliationRunListQuery = {}): Promise<ReconciliationRunPage> {
    assertScope(principal, RECON_READ_SCOPE)
    return this.store.list(query)
  }

  async getRun(principal: Principal, runId: string): Promise<StoredReconciliationRun | null> {
    assertScope(principal, RECON_READ_SCOPE)
    return this.store.get(runId)
  }

  /** BACKOFFICE-12 — read the effective break-threshold set (reconciliation:read). */
  async getThresholds(principal: Principal): Promise<BreakThreshold[]> {
    assertScope(principal, RECON_READ_SCOPE)
    return this.effectiveThresholds()
  }

  /**
   * BACKOFFICE-12 — update break thresholds per fee class (platform:operations:write).
   * Edits take effect on the NEXT run (the engine reads the set at run time), never
   * retroactively. High-class audited with old/new values; Finance + Compliance are
   * notified via P3 ITSM. Validates fee_class / unit / non-negative integer value.
   */
  async updateThresholds(principal: Principal, input: BreakThreshold[], traceId: string): Promise<BreakThreshold[]> {
    assertScope(principal, OPS_WRITE_SCOPE)
    if (!Array.isArray(input) || input.length === 0) {
      throw new BreakWorkflowError('BACKOFFICE.INVALID_THRESHOLDS', 'Provide a non-empty array of thresholds.', 400)
    }
    const validClasses = new Set(DEFAULT_THRESHOLDS.map((t) => t.fee_class))
    const seen = new Set<string>()
    for (const t of input) {
      if (!validClasses.has(t.fee_class)) {
        throw new BreakWorkflowError('BACKOFFICE.INVALID_THRESHOLDS', `Unknown fee_class "${t.fee_class}".`, 400)
      }
      if (seen.has(t.fee_class)) {
        throw new BreakWorkflowError('BACKOFFICE.INVALID_THRESHOLDS', `Duplicate fee_class "${t.fee_class}".`, 400)
      }
      seen.add(t.fee_class)
      if (!Number.isInteger(t.threshold_value) || t.threshold_value < 0) {
        throw new BreakWorkflowError('BACKOFFICE.INVALID_THRESHOLDS', 'threshold_value must be a non-negative integer.', 400)
      }
      if (t.unit !== 'aed' && t.unit !== 'count') {
        throw new BreakWorkflowError('BACKOFFICE.INVALID_THRESHOLDS', 'unit must be "aed" or "count".', 400)
      }
    }
    const before = await this.effectiveThresholds()
    if (!this.thresholdStore) {
      throw new BreakWorkflowError('BACKOFFICE.THRESHOLDS_READ_ONLY', 'No threshold store configured.', 503)
    }
    await this.thresholdStore.replaceAll(input, principal.subject, traceId)
    const after = await this.effectiveThresholds()

    // High-class audit with the old/new values (never retroactive — next-run effect).
    await this.audit.emit({
      event_type: 'reconciliation_thresholds_updated',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: OPS_WRITE_SCOPE,
      request_trace_id: traceId,
      request_body: { changed: input, old_values: before, new_values: after, effect: 'next_run_only' },
      response_status: 200
    })

    // Finance + Compliance notified (PRD §7 BACKOFFICE-12).
    for (const team of ['finance', 'compliance']) {
      await this.itsm?.createTicket(
        { type: 'threshold_change', severity: 'low', team, summary: `Break thresholds updated by ${principal.persona} (${input.length} class(es)) — effective next run` },
        { trace_id: traceId }
      )
    }
    return after
  }

  async listBreaks(principal: Principal, query: ReconciliationBreakListQuery = {}): Promise<ReconciliationBreakPage> {
    assertScope(principal, RECON_READ_SCOPE)
    if (!this.breakStore) return { rows: [], next_cursor: null }
    return this.breakStore.list(query)
  }

  /**
   * BACKOFFICE-11 — break detail for the three-source side-by-side diff view: the
   * Nebras / platform / fintech source refs + the highlighted variance. The
   * originating FAPI transaction is linked via the propagated x-fapi-interaction-id.
   */
  async getBreak(principal: Principal, breakId: string): Promise<StoredReconciliationBreak | null> {
    assertScope(principal, RECON_READ_SCOPE)
    if (!this.breakStore) return null
    return this.breakStore.get(breakId)
  }

  /**
   * BACKOFFICE-03 — claim a flagged break: → assigned, record the claimant, start
   * the SLA clock, remove it from every other claimant's queue. Requires
   * finance:reconciliation:write; consent-record breaks may alternatively be
   * claimed with platform:operations:write (per the contract description).
   */
  async claimBreak(principal: Principal, breakId: string, traceId: string): Promise<StoredReconciliationBreak> {
    if (!this.breakStore) throw new BreakWorkflowError('BACKOFFICE.BREAK_NOT_FOUND', 'No break store configured.', 404)
    const existing = await this.breakStore.get(breakId)
    if (!existing) throw new BreakWorkflowError('BACKOFFICE.BREAK_NOT_FOUND', `No break ${breakId}.`, 404)

    const canFinance = hasScope(principal.scopes, RECON_WRITE_SCOPE)
    const canOps = existing.line_type === 'consent_record' && hasScope(principal.scopes, OPS_WRITE_SCOPE)
    if (!canFinance && !canOps) throw new ScopeDeniedError(RECON_WRITE_SCOPE, principal.persona)

    if (existing.status !== 'flagged') {
      throw new BreakWorkflowError('BACKOFFICE.BREAK_NOT_CLAIMABLE', `break is ${existing.status}, not flagged`, 409)
    }
    const claimed = await this.breakStore.claim(breakId, principal.subject, traceId)
    if (!claimed) throw new BreakWorkflowError('BACKOFFICE.BREAK_NOT_CLAIMABLE', 'break was claimed by another principal', 409)

    await this.audit.emit({
      event_type: 'reconciliation_break_claimed',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: canFinance ? RECON_WRITE_SCOPE : OPS_WRITE_SCOPE,
      request_trace_id: traceId,
      request_body: { break_id: breakId, run_id: claimed.run_id, line_type: claimed.line_type, status: claimed.status },
      response_status: 200,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })
    return claimed
  }

  /**
   * BACKOFFICE-04 — resolve a break to a terminal outcome with a mandatory note
   * (≥20 chars). Terminal-state transition; the immutable audit record carries
   * the resolution. Re-resolving an already-terminal break → 409.
   */
  async resolveBreak(principal: Principal, breakId: string, outcome: string, note: string, traceId: string): Promise<StoredReconciliationBreak> {
    assertScope(principal, RECON_WRITE_SCOPE)
    if (!(RESOLVE_OUTCOMES as readonly string[]).includes(outcome)) {
      throw new BreakWorkflowError('BACKOFFICE.INVALID_OUTCOME', `resolution_outcome must be one of: ${RESOLVE_OUTCOMES.join(', ')}.`, 400)
    }
    if (!note || note.trim().length < MIN_NOTE) {
      throw new BreakWorkflowError('BACKOFFICE.RESOLUTION_NOTE_REQUIRED', `resolution_note must be at least ${MIN_NOTE} characters.`, 400)
    }
    if (!this.breakStore) throw new BreakWorkflowError('BACKOFFICE.BREAK_NOT_FOUND', `No break ${breakId}.`, 404)
    const existing = await this.breakStore.get(breakId)
    if (!existing) throw new BreakWorkflowError('BACKOFFICE.BREAK_NOT_FOUND', `No break ${breakId}.`, 404)
    if (TERMINAL_STATUSES.has(existing.status)) {
      throw new BreakWorkflowError('BACKOFFICE.BREAK_ALREADY_RESOLVED', `break is ${existing.status} (terminal)`, 409)
    }
    const resolved = await this.breakStore.resolve(breakId, outcome, note, traceId)
    if (!resolved) throw new BreakWorkflowError('BACKOFFICE.BREAK_ALREADY_RESOLVED', 'break was resolved concurrently', 409)

    await this.audit.emit({
      event_type: 'reconciliation_break_resolved',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: RECON_WRITE_SCOPE,
      request_trace_id: traceId,
      request_body: { break_id: breakId, run_id: resolved.run_id, resolution_outcome: outcome, resolution_note: note },
      response_status: 200,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })
    return resolved
  }

  /**
   * BACKOFFICE-04 — initiate a four-eyes reopen of a resolved break. Requires
   * audit:read (Compliance) + a justification (≥20 chars); returns 202 +
   * approval_request. A different audit:read principal approves before the break
   * is reopened (the reconciliation.break_reopen operation executes on approval).
   */
  async initiateReopen(principal: Principal, breakId: string, justification: string, traceId: string): Promise<ApprovalRecord> {
    assertScope(principal, COMPLIANCE_SCOPE)
    if (!justification || justification.trim().length < MIN_NOTE) {
      throw new BreakWorkflowError('BACKOFFICE.JUSTIFICATION_REQUIRED', `justification must be at least ${MIN_NOTE} characters.`, 400)
    }
    if (!this.breakStore) throw new BreakWorkflowError('BACKOFFICE.BREAK_NOT_FOUND', `No break ${breakId}.`, 404)
    if (!this.approvals) throw new BreakWorkflowError('BACKOFFICE.REOPEN_UNAVAILABLE', 'Reopen is not configured.', 404)
    const existing = await this.breakStore.get(breakId)
    if (!existing) throw new BreakWorkflowError('BACKOFFICE.BREAK_NOT_FOUND', `No break ${breakId}.`, 404)
    if (!TERMINAL_STATUSES.has(existing.status)) {
      throw new BreakWorkflowError('BACKOFFICE.BREAK_NOT_RESOLVED', `break is ${existing.status}, not resolved — nothing to reopen`, 409)
    }
    return this.approvals.requestApproval(
      principal,
      {
        operation_type: BREAK_REOPEN_OPERATION,
        operation_payload: {
          break_id: breakId,
          justification,
          initiated_by: principal.subject,
          initiated_by_persona: principal.persona,
          trace_id: traceId
        }
      },
      traceId
    )
  }

  /**
   * BACKOFFICE-05 — one-click escalation of a break to a Nebras dispute case. Opens
   * the case through the P6 egress gateway (FAPI 2.0 mTLS + evidence bundle handled
   * by the gateway — no direct egress), persists the Nebras case id + transitions
   * the break to escalated_nebras_dispute. Requires finance:disputes:write.
   */
  async escalateToNebras(principal: Principal, breakId: string, traceId: string): Promise<{ break_id: string; status: string; nebras_dispute_case_id: string }> {
    assertScope(principal, DISPUTES_WRITE_SCOPE)
    if (!this.breakStore) throw new BreakWorkflowError('BACKOFFICE.BREAK_NOT_FOUND', `No break ${breakId}.`, 404)
    if (!this.egress) throw new BreakWorkflowError('BACKOFFICE.ESCALATE_UNAVAILABLE', 'Nebras escalation is not configured.', 404)
    const existing = await this.breakStore.get(breakId)
    if (!existing) throw new BreakWorkflowError('BACKOFFICE.BREAK_NOT_FOUND', `No break ${breakId}.`, 404)
    if (existing.status !== 'flagged' && existing.status !== 'assigned') {
      throw new BreakWorkflowError('BACKOFFICE.BREAK_NOT_ESCALATABLE', `break is ${existing.status}, not open`, 409)
    }

    // Evidence bundle — the three source refs + variance for the dispute (no PSU PII).
    const evidence = {
      break_id: breakId,
      run_id: existing.run_id,
      line_type: existing.line_type,
      variance_amount: existing.variance_amount,
      variance_count: existing.variance_count,
      source_a_ref: existing.source_a_ref,
      source_b_ref: existing.source_b_ref,
      source_c_ref: existing.source_c_ref
    }
    const { nebras_case_id } = await this.egress.createDisputeCase(evidence, { trace_id: traceId })
    const escalated = await this.breakStore.escalateNebras(breakId, nebras_case_id, traceId)
    if (!escalated) throw new BreakWorkflowError('BACKOFFICE.BREAK_NOT_ESCALATABLE', 'break was escalated/resolved concurrently', 409)

    await this.audit.emit({
      event_type: 'reconciliation_break_escalated_nebras',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: DISPUTES_WRITE_SCOPE,
      request_trace_id: traceId,
      request_body: { break_id: breakId, run_id: escalated.run_id, nebras_dispute_case_id: nebras_case_id, line_type: escalated.line_type },
      response_status: 200,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })
    return { break_id: breakId, status: escalated.status, nebras_dispute_case_id: nebras_case_id }
  }

  /**
   * BACKOFFICE-31 — TPP-aaS margin by fintech + product family for a calendar
   * month, re-derived from each run's deterministic sources (same basis as the
   * monthly sign-off). Read-only; reconciliation:read. For the Finance View.
   */
  async marginForPeriod(principal: Principal, period: string): Promise<MarginSummary> {
    assertScope(principal, RECON_READ_SCOPE)
    return this.computeMarginForPeriod(period)
  }

  /**
   * BACKOFFICE-27 — the same per-fintech/per-family margin computation WITHOUT a
   * reconciliation:read assertion, for composition into the Executive Dashboard
   * (gated by the dashboard's own platform:analytics:read + commercial:read).
   * Not a public read surface — only the dashboard wiring calls it.
   */
  async computeMarginForPeriod(period: string): Promise<MarginSummary> {
    const runs = await this.store.listForPrefix(`recon-${period}-`)
    const margin = emptyMargin()
    for (const run of runs) {
      const runPeriod = dateKey(new Date(run.window_start))
      mergeMargin(margin, await this.marginFor(this.sourcesFor(runPeriod), { start: run.window_start, end: run.window_end }))
    }
    return margin
  }

  /** BACKOFFICE-31 — the open Nebras dispute queue size for a month (Finance View). */
  async openNebrasDisputeCount(principal: Principal, period: string): Promise<number> {
    assertScope(principal, RECON_READ_SCOPE)
    if (!this.breakStore) return 0
    const byStatus = await this.breakStore.summarizeByStatus(`recon-${period}-`)
    return byStatus['escalated_nebras_dispute'] ?? 0
  }

  /**
   * BACKOFFICE-06 — month-close: generate + lock the monthly reconciliation summary
   * (run count, break counts by disposition, open Nebras disputes; TPP-aaS margin
   * is enriched by BACKOFFICE-07) and persist it as a compliance_report with the
   * Finance Analyst's IdP-attested sign-off (approved_by = the authenticated
   * principal) + a SHA-256 integrity hash. The report is the locked, 5-yr-archived
   * artifact; PDF/XLSX rendering is a downstream concern off this signed record.
   */
  /**
   * BACKOFFICE-06 — REQUEST the monthly sign-off (four-eyes). The initiator
   * (finance:reconciliation:write) creates an approval; a DIFFERENT finance principal
   * approves, and only then is the report generated + locked (executeMonthlySignoff via
   * the reconciliation.monthly_signoff operation). Returns the approval_request (202),
   * never executes inline — the binding four-eyes hard-stop.
   */
  async initiateMonthlySignoff(principal: Principal, period: string, traceId: string): Promise<ApprovalRecord> {
    assertScope(principal, RECON_WRITE_SCOPE)
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      throw new BreakWorkflowError('BACKOFFICE.INVALID_PERIOD', 'period must be a calendar month YYYY-MM.', 400)
    }
    if (!this.reports || !this.breakStore) throw new BreakWorkflowError('BACKOFFICE.SIGNOFF_UNAVAILABLE', 'Monthly sign-off is not configured.', 404)
    if (!this.approvals) throw new BreakWorkflowError('BACKOFFICE.SIGNOFF_UNAVAILABLE', 'Monthly sign-off four-eyes is not configured.', 404)
    return this.approvals.requestApproval(
      principal,
      {
        operation_type: MONTHLY_SIGNOFF_OPERATION,
        operation_payload: { period, initiated_by: principal.subject, initiated_by_persona: principal.persona, trace_id: traceId }
      },
      traceId
    )
  }

  /**
   * Execute the month-close sign-off AFTER four-eyes approval — generate + lock the
   * compliance_report attested to the INITIATOR (attestedBy). Scope is already enforced by
   * the approvals flow (initiator at request, a different approver at approve), so it is not
   * re-asserted here; this is reachable only via the registered four-eyes operation.
   */
  async executeMonthlySignoff(period: string, attestedBy: string, attestedByPersona: string, traceId: string): Promise<StoredComplianceReport> {
    if (!this.reports || !this.breakStore) throw new BreakWorkflowError('BACKOFFICE.SIGNOFF_UNAVAILABLE', 'Monthly sign-off is not configured.', 404)
    const prefix = `recon-${period}-`
    const [runs, byStatus] = await Promise.all([this.store.listForPrefix(prefix), this.breakStore.summarizeByStatus(prefix)])
    const sum = (keys: string[]) => keys.reduce((n, k) => n + (byStatus[k] ?? 0), 0)
    // BACKOFFICE-07 — TPP-aaS margin for the month: re-derive each run's sources
    // (deterministic) and accumulate the per-fintech / per-product-family margin.
    const margin = emptyMargin()
    for (const run of runs) {
      const runPeriod = dateKey(new Date(run.window_start))
      mergeMargin(margin, await this.marginFor(this.sourcesFor(runPeriod), { start: run.window_start, end: run.window_end }))
    }
    const summary = {
      period,
      run_count: runs.length,
      breaks: {
        total: Object.values(byStatus).reduce((n, v) => n + v, 0),
        open: sum(OPEN_STATUSES),
        resolved: sum(RESOLVED_STATUSES),
        escalated: sum(ESCALATED_STATUSES),
        by_status: byStatus
      },
      open_nebras_disputes: byStatus['escalated_nebras_dispute'] ?? 0,
      tpp_aas_margin: margin
    }
    const start = `${period}-01T00:00:00.000Z`
    const end = this.now().toISOString()
    const integrity_hash = createHash('sha256').update(canonicalJson(summary)).digest('hex')

    const report = await this.reports.create(
      {
        report_type: MONTHLY_REPORT_TYPE,
        // Generated + signed off in one Finance Analyst action (IdP-attested).
        status: 'approved',
        reporting_period_start: start,
        reporting_period_end: end,
        classification: 'restricted',
        requested_by: attestedBy,
        approved_by: attestedBy,
        integrity_hash,
        generated_at: end,
        content: summary
      },
      traceId
    )

    await this.audit.emit({
      event_type: 'reconciliation_monthly_signoff',
      acting_principal: attestedBy,
      acting_persona: attestedByPersona,
      scope_used: RECON_WRITE_SCOPE,
      request_trace_id: traceId,
      request_body: { report_id: report.id, period, run_count: runs.length, break_total: summary.breaks.total, integrity_hash, four_eyes_approved: true },
      response_status: 200
    })
    return report
  }

  /**
   * BACKOFFICE-08 — CBUAE-format reconciliation audit-trail export for a date
   * range: every run + break in the window becomes a line with a per-line SHA-256
   * integrity hash, plus an overall hash. Persisted as a compliance_report
   * (awaiting_approval — CBUAE submission is four-eyes, BACKOFFICE-35). Returns the
   * report (202). The XLSX + PDF cover are rendered downstream off this record.
   * compliance:reports:generate (Compliance Officer).
   */
  async generateCbuaeExport(principal: Principal, periodStart: string, periodEnd: string, traceId: string): Promise<StoredComplianceReport> {
    assertScope(principal, COMPLIANCE_GENERATE_SCOPE)
    const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
    if (!isDate(periodStart) || !isDate(periodEnd) || periodStart > periodEnd) {
      throw new BreakWorkflowError('BACKOFFICE.INVALID_PERIOD', 'period_start and period_end must be dates (YYYY-MM-DD) with start <= end.', 400)
    }
    if (!this.reports || !this.breakStore) throw new BreakWorkflowError('BACKOFFICE.EXPORT_UNAVAILABLE', 'CBUAE export is not configured.', 404)
    const start = `${periodStart}T00:00:00.000Z`
    // period_end is inclusive of the whole day → exclusive bound is the next day 00:00
    const endExclusive = new Date(Date.parse(`${periodEnd}T00:00:00.000Z`) + 24 * 60 * 60 * 1000).toISOString()

    const [runs, breaks] = await Promise.all([this.store.listForRange(start, endExclusive), this.breakStore.listForRange(start, endExclusive)])
    const runLines = runs.map((r) => ({
      run_id: r.run_id, run_type: r.run_type, status: r.status,
      window_start: r.window_start, window_end: r.window_end,
      line_count_total: r.line_count_total, line_count_matched: r.line_count_matched,
      line_count_unmatched: r.line_count_unmatched, line_count_disputed: r.line_count_disputed
    }))
    const breakLines = breaks.map((b) => ({
      run_id: b.run_id, line_type: b.line_type, status: b.status,
      variance_amount: b.variance_amount, variance_count: b.variance_count,
      source_a_ref: b.source_a_ref, source_b_ref: b.source_b_ref, source_c_ref: b.source_c_ref,
      resolution_outcome: b.resolution_outcome, nebras_dispute_case_id: b.nebras_dispute_case_id
    }))
    // Redact before hashing so a verifier re-hashing the persisted (redacted) export
    // reproduces the line hashes (redactPii is idempotent) — same evidence-grade
    // pattern as the inquiry bundle (BACKOFFICE-23).
    const sections = redactPii({ runs: runLines, breaks: breakLines }) as { runs: unknown[]; breaks: unknown[] }
    const line_hashes = {
      runs: sections.runs.map(lineHash),
      breaks: sections.breaks.map(lineHash)
    }
    const period = { start: periodStart, end: periodEnd }
    const content = { format: 'cbuae_reconciliation_v1', period, sections, line_hashes, run_count: runs.length, break_count: breaks.length }
    const integrity_hash = createHash('sha256').update(canonicalJson({ content_line_hashes: line_hashes, period })).digest('hex')
    const generatedAt = this.now().toISOString()

    const report = await this.reports.create(
      {
        report_type: CBUAE_EXPORT_REPORT_TYPE,
        status: 'awaiting_approval', // CBUAE-bound submission is four-eyes (BACKOFFICE-35)
        reporting_period_start: start,
        reporting_period_end: endExclusive,
        classification: 'restricted',
        requested_by: principal.subject,
        integrity_hash,
        generated_at: generatedAt,
        content
      },
      traceId
    )

    await this.audit.emit({
      event_type: 'cbuae_reconciliation_export_generated',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: COMPLIANCE_GENERATE_SCOPE,
      request_trace_id: traceId,
      request_body: { report_id: report.id, period, run_count: runs.length, break_count: breaks.length, integrity_hash },
      response_status: 202,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })
    return report
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
  async countForPrefix(runIdPrefix: string): Promise<number> {
    return this.rows.filter((r) => r.run_id.startsWith(runIdPrefix)).length
  }
  async listForPrefix(runIdPrefix: string): Promise<StoredReconciliationRun[]> {
    return this.rows.filter((r) => r.run_id.startsWith(runIdPrefix)).sort((a, b) => a.window_start.localeCompare(b.window_start))
  }
  async listForRange(start: string, end: string): Promise<StoredReconciliationRun[]> {
    return this.rows.filter((r) => r.created_at >= start && r.created_at < end).sort((a, b) => a.created_at.localeCompare(b.created_at))
  }
  async list(query: ReconciliationRunListQuery = {}): Promise<ReconciliationRunPage> {
    let rows = this.rows
    if (query.run_type) rows = rows.filter((r) => r.run_type === query.run_type)
    if (query.status) rows = rows.filter((r) => r.status === query.status)
    return { rows: rows.slice(0, Math.min(Math.max(query.limit ?? 50, 1), 200)), next_cursor: null }
  }
}

/** No-database default (tests / local dev). */
export class InMemoryReconciliationBreakStore implements ReconciliationBreakStore {
  private readonly rows: StoredReconciliationBreak[] = []
  async createMany(inputs: ReconciliationBreakCreateInput[]): Promise<StoredReconciliationBreak[]> {
    const now = new Date().toISOString()
    const created = inputs.map((input) => ({
      id: crypto.randomUUID(),
      run_id: input.run_id,
      client_id: input.client_id ?? null,
      channel: 'internal_retail',
      line_type: input.line_type,
      status: 'flagged',
      variance_amount: input.variance_amount ?? null,
      variance_count: input.variance_count ?? null,
      source_a_ref: input.source_a_ref,
      source_b_ref: input.source_b_ref,
      source_c_ref: input.source_c_ref ?? null,
      assigned_to: null,
      sla_clock_started_at: now,
      resolution_outcome: null,
      resolution_note: null,
      nebras_dispute_case_id: null,
      reopened_count: 0,
      resolved_at: null,
      created_at: now
    }))
    this.rows.unshift(...created)
    return created
  }
  async countForRun(runId: string): Promise<number> {
    return this.rows.filter((r) => r.run_id === runId).length
  }
  async get(id: string): Promise<StoredReconciliationBreak | null> {
    return this.rows.find((r) => r.id === id) ?? null
  }
  async claim(id: string, assignedTo: string): Promise<StoredReconciliationBreak | null> {
    const row = this.rows.find((r) => r.id === id)
    if (!row || row.status !== 'flagged') return null
    row.status = 'assigned'
    row.assigned_to = assignedTo
    row.sla_clock_started_at = new Date().toISOString()
    return row
  }
  async resolve(id: string, outcome: string, note: string): Promise<StoredReconciliationBreak | null> {
    const row = this.rows.find((r) => r.id === id)
    if (!row || !(row.status === 'flagged' || row.status === 'assigned')) return null
    row.status = outcome
    row.resolution_outcome = outcome
    row.resolution_note = note
    row.resolved_at = new Date().toISOString()
    return row
  }
  async reopen(id: string): Promise<StoredReconciliationBreak | null> {
    const row = this.rows.find((r) => r.id === id)
    const terminal = new Set(['resolved_matched', 'resolved_internal_correction', 'escalated_nebras_dispute', 'escalated_fintech_billing'])
    if (!row || !terminal.has(row.status)) return null
    row.status = 'flagged'
    row.assigned_to = null
    row.resolution_outcome = null
    row.resolution_note = null
    row.sla_clock_started_at = null
    row.resolved_at = null
    row.reopened_count += 1
    return row
  }
  async escalateNebras(id: string, nebrasCaseId: string): Promise<StoredReconciliationBreak | null> {
    const row = this.rows.find((r) => r.id === id)
    if (!row || !(row.status === 'flagged' || row.status === 'assigned')) return null
    row.status = 'escalated_nebras_dispute'
    row.nebras_dispute_case_id = nebrasCaseId
    return row
  }
  async summarizeByStatus(runIdPrefix: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {}
    for (const r of this.rows) if (r.run_id.startsWith(runIdPrefix)) out[r.status] = (out[r.status] ?? 0) + 1
    return out
  }
  async listForRange(start: string, end: string): Promise<StoredReconciliationBreak[]> {
    return this.rows.filter((r) => r.created_at >= start && r.created_at < end).sort((a, b) => a.created_at.localeCompare(b.created_at))
  }
  async list(query: ReconciliationBreakListQuery = {}): Promise<ReconciliationBreakPage> {
    let rows = this.rows
    if (query.run_id) rows = rows.filter((r) => r.run_id === query.run_id)
    if (query.status) rows = rows.filter((r) => r.status === query.status)
    if (query.line_type) rows = rows.filter((r) => r.line_type === query.line_type)
    if (query.client_id) rows = rows.filter((r) => r.client_id === query.client_id)
    return { rows: rows.slice(0, Math.min(Math.max(query.limit ?? 50, 1), 200)), next_cursor: null }
  }
}

/**
 * BACKOFFICE-12 — in-memory thresholds for the demo default + tests. Mirrors the
 * Pg store: upsert per fee class, list returns the current overrides (the service
 * overlays them on the engine defaults).
 */
export class InMemoryReconciliationThresholdStore implements ThresholdStore {
  private readonly byClass = new Map<string, BreakThreshold>()
  async list(): Promise<BreakThreshold[]> {
    return [...this.byClass.values()]
  }
  async replaceAll(thresholds: BreakThreshold[], _updatedBy: string, _traceId: string): Promise<BreakThreshold[]> {
    for (const t of thresholds) this.byClass.set(t.fee_class, { fee_class: t.fee_class, threshold_value: t.threshold_value, unit: t.unit })
    return [...this.byClass.values()]
  }
}
