import type {
  StoredReconciliationRun,
  ReconciliationRunCreateInput,
  ReconciliationRunListQuery,
  ReconciliationRunPage,
  StoredReconciliationBreak,
  ReconciliationBreakCreateInput,
  ReconciliationBreakListQuery,
  ReconciliationBreakPage
} from '@ofbo/db'
import type { ApmPort, ItsmPort, NebrasEgressPort, OtelSpan } from '@ofbo/ports'
import { redactText } from '@ofbo/redaction'
import type { Principal } from '../auth.js'
import { assertScope, hasScope, ScopeDeniedError } from '../rbac.js'
import type { HighClassAuditSink } from '../high-class-audit.js'
import type { ApprovalRecord, GatedOperation } from '../approvals/service.js'
import { runThreeWayReconciliation, type ReconLineResult, type ReconResult, type ReconSources, type ReconWindow } from './engine.js'
import { buildSimReconSources, type SimReconConfig } from './sources.js'
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
  list(query?: ReconciliationBreakListQuery): Promise<ReconciliationBreakPage>
}

export const RECON_WRITE_SCOPE = 'finance:reconciliation:write'
export const OPS_WRITE_SCOPE = 'platform:operations:write'
export const DISPUTES_WRITE_SCOPE = 'finance:disputes:write'
export const COMPLIANCE_SCOPE = 'audit:read'
export const BREAK_REOPEN_OPERATION = 'reconciliation.break_reopen'
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
  /** BACKOFFICE-04 — four-eyes reopen initiation (omit to disable reopen). */
  approvals?: ReopenApprovalRequester
  /** BACKOFFICE-05 — P6 egress for Nebras dispute-case creation (omit to disable escalate). */
  egress?: Pick<NebrasEgressPort, 'createDisputeCase'>
  /** BACKOFFICE-13 — P5 APM sink for per-run/per-line OTel spans (omit to skip). */
  apm?: Pick<ApmPort, 'exportSpans'>
  now?: () => Date
}

export interface ReconRunResult {
  run: StoredReconciliationRun
  created: boolean
  result: ReconResult
  breaks: StoredReconciliationBreak[]
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
  private readonly approvals?: ReopenApprovalRequester
  private readonly egress?: Pick<NebrasEgressPort, 'createDisputeCase'>
  private readonly apm?: Pick<ApmPort, 'exportSpans'>
  private readonly now: () => Date

  constructor(deps: ReconciliationDeps) {
    this.store = deps.store
    this.audit = deps.audit
    this.sourcesFor = deps.sourcesFor ?? ((period: string) => buildSimReconSources(period))
    this.breakStore = deps.breakStore
    this.itsm = deps.itsm
    this.thresholds = deps.thresholds ?? DEFAULT_THRESHOLDS
    this.approvals = deps.approvals
    this.egress = deps.egress
    this.apm = deps.apm
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

    const spanStart = this.now().getTime()
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

    // BACKOFFICE-02 — break detection. Only on an actually-executed run, and
    // only once per run_id (a re-run that already has breaks is a no-op).
    const breaks = created ? await this.detectAndRecordBreaks(runId, result, traceId) : []

    // BACKOFFICE-13 — OTel: one run span + one span per reconciled line.
    if (created) this.emitRunSpans(runId, runType, result, traceId, spanStart)

    return { run, created, result, breaks }
  }

  /**
   * BACKOFFICE-13 — emit a parent run span plus one child span per reconciled
   * line, exported via the P5 APM bridge (OTel is the canonical stream; never a
   * second instrumentation path). Span attributes carry run_id, line_type, the
   * three source refs, the variance and the decision. Telemetry never fails a run.
   */
  private emitRunSpans(runId: string, runType: string, result: ReconResult, traceId: string, startMs: number): void {
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
        'recon.line_count_disputed': result.line_count_disputed
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

  private async detectAndRecordBreaks(runId: string, result: ReconResult, traceId: string): Promise<StoredReconciliationBreak[]> {
    if (!this.breakStore) return []
    if ((await this.breakStore.countForRun(runId)) > 0) return [] // already detected for this run
    const detected = detectBreaks(result, this.thresholds)
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
  async list(query: ReconciliationBreakListQuery = {}): Promise<ReconciliationBreakPage> {
    let rows = this.rows
    if (query.run_id) rows = rows.filter((r) => r.run_id === query.run_id)
    if (query.status) rows = rows.filter((r) => r.status === query.status)
    if (query.line_type) rows = rows.filter((r) => r.line_type === query.line_type)
    if (query.client_id) rows = rows.filter((r) => r.client_id === query.client_id)
    return { rows: rows.slice(0, Math.min(Math.max(query.limit ?? 50, 1), 200)), next_cursor: null }
  }
}
