import type { StrWorkflowPort } from '@ofbo/ports'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import type { HighClassAuditSink } from '../high-class-audit.js'
import type { ApprovalRecord, GatedOperation } from '../approvals/service.js'
import { ApprovalsService } from '../approvals/service.js'

/**
 * BACKOFFICE-63 — STR (Suspicious Transaction Report) draft handoff (ADR 0022). Drafts are
 * auto-created on a fraud-suspected revocation (BACKOFFICE-22) and held by the Back Office.
 * Compliance hands an approved draft to the bank's STR workflow (P10), which submits to the
 * CBUAE AML GO portal — the Back Office NEVER submits directly. The handoff is four-eyes:
 * Compliance (compliance:reports:generate) initiates → 202; a Risk second-line (risk:read,
 * the persona that owns STR triggers) approves, and only then does the P10 handoff run.
 * No PII — a draft carries an internal consent ref + case context, never PSU identifiers.
 */

export const STR_READ_SCOPE = 'compliance:reports:read'
export const STR_HANDOFF_SCOPE = 'compliance:reports:generate'
export const STR_HANDOFF_APPROVER_SCOPE = 'risk:read'
export const STR_HANDOFF_OPERATION = 'compliance.str_handoff'

export type StrDraftStatus = 'draft' | 'awaiting_handoff' | 'handed_off'

export interface StrDraft {
  str_draft_id: string
  source_consent_id: string
  case_context: string
  status: StrDraftStatus
  created_by: string
  approval_id: string | null
  workflow_ref: string | null
  approved_by: string | null
  handed_off_at: string | null
  created_at: string
}

export interface StrDraftRecordInput {
  source_consent_id: string
  case_context: string
  created_by: string
}
export interface StrDraftListQuery {
  cursor?: string
  limit?: number
  status?: string
}
export interface StrDraftPage {
  rows: StrDraft[]
  next_cursor: string | null
}
export interface StrStatusPatch {
  approval_id?: string | null
  workflow_ref?: string | null
  approved_by?: string | null
  handed_off_at?: string | null
}

export interface StrDraftStore {
  record(input: StrDraftRecordInput, traceId: string): Promise<StrDraft>
  get(id: string): Promise<StrDraft | null>
  list(query: StrDraftListQuery): Promise<StrDraftPage>
  markStatus(id: string, status: StrDraftStatus, patch: StrStatusPatch, traceId?: string): Promise<StrDraft | null>
}

export class StrError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export function toWire(d: StrDraft) {
  return {
    str_draft_id: d.str_draft_id,
    source_consent_id: d.source_consent_id,
    case_context: d.case_context,
    status: d.status,
    created_by: d.created_by,
    approval_id: d.approval_id,
    workflow_ref: d.workflow_ref,
    approved_by: d.approved_by,
    handed_off_at: d.handed_off_at,
    created_at: d.created_at
  }
}

/**
 * The four-eyes executor: on the Risk second-line's approval, hand the draft to the bank's
 * STR workflow (P10) and record the workflow reference. This is the ONLY place an STR leaves
 * the Back Office — and it goes to the workflow, never to AML GO directly.
 */
export function makeStrHandoffOperation(deps: {
  store: Pick<StrDraftStore, 'markStatus'>
  strWorkflow: StrWorkflowPort
  audit: HighClassAuditSink
}): GatedOperation {
  return {
    initiatorScope: STR_HANDOFF_SCOPE,
    approverScope: STR_HANDOFF_APPROVER_SCOPE,
    execute: async (payload, ctx) => {
      const strDraftId = String(payload.str_draft_id)
      const sourceConsentId = String(payload.source_consent_id)
      const caseContext = String(payload.case_context ?? '')
      const traceId = String(payload.trace_id ?? 'unknown')

      const handoff = await deps.strWorkflow.handoffStrDraft(
        { str_draft_id: strDraftId, source_consent_id: sourceConsentId, case_context: caseContext },
        { trace_id: traceId }
      )
      const handedOffAt = new Date().toISOString()
      await deps.store.markStatus(
        strDraftId,
        'handed_off',
        { workflow_ref: handoff.workflow_ref, handed_off_at: handedOffAt, approved_by: ctx?.approver ?? null },
        traceId
      )
      await deps.audit.emit({
        event_type: 'str_draft_handed_off',
        acting_principal: ctx?.approver ?? String(payload.initiated_by ?? 'unknown'),
        acting_persona: ctx?.approverPersona ?? STR_HANDOFF_APPROVER_SCOPE,
        scope_used: STR_HANDOFF_APPROVER_SCOPE,
        target_consent_id: sourceConsentId,
        request_trace_id: traceId,
        request_body: { str_draft_id: strDraftId, workflow_ref: handoff.workflow_ref, source_consent_id: sourceConsentId, four_eyes_approved: true },
        response_status: 200
      })
      return { str_draft_id: strDraftId, status: 'handed_off', workflow_ref: handoff.workflow_ref, accepted_at: handoff.accepted_at }
    }
  }
}

export class StrDraftService {
  constructor(
    private readonly approvals: Pick<ApprovalsService, 'requestApproval'>,
    private readonly store: StrDraftStore,
    private readonly audit: HighClassAuditSink
  ) {}

  async list(principal: Principal, query: StrDraftListQuery): Promise<StrDraftPage> {
    assertScope(principal, STR_READ_SCOPE)
    return this.store.list(query)
  }

  async get(principal: Principal, id: string): Promise<StrDraft> {
    assertScope(principal, STR_READ_SCOPE)
    const d = await this.store.get(id)
    if (!d) throw new StrError('BACKOFFICE.STR_DRAFT_NOT_FOUND', 'No STR draft matches that id.', 404)
    return d
  }

  /** Initiate the four-eyes handoff. Scopes are enforced here AND by the approvals service. */
  async submitToWorkflow(principal: Principal, id: string, traceId: string): Promise<ApprovalRecord> {
    assertScope(principal, STR_HANDOFF_SCOPE)
    const draft = await this.store.get(id)
    if (!draft) throw new StrError('BACKOFFICE.STR_DRAFT_NOT_FOUND', 'No STR draft matches that id.', 404)
    if (draft.status !== 'draft') {
      throw new StrError('BACKOFFICE.STR_DRAFT_NOT_SUBMITTABLE', `STR draft is ${draft.status}; only a draft can be submitted to the workflow.`, 409)
    }
    const approval = await this.approvals.requestApproval(
      principal,
      {
        operation_type: STR_HANDOFF_OPERATION,
        operation_payload: {
          str_draft_id: id,
          source_consent_id: draft.source_consent_id,
          case_context: draft.case_context,
          initiated_by: principal.subject,
          initiated_by_persona: principal.persona,
          trace_id: traceId
        }
      },
      traceId
    )
    await this.store.markStatus(id, 'awaiting_handoff', { approval_id: approval.approval_request_id }, traceId)
    return approval
  }
}

const encodeCursor = (createdAt: string, id: string) => Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url')

/**
 * No-database default (tests / demo profile). The worker wires a durable Pg store (RLS +
 * 24/60 retention + BCBS 239 lineage) at the M-tier follow-up — the service depends only on
 * the interface. Optionally seeds a couple of synthetic demo drafts so the list is non-empty.
 */
export class InMemoryStrDraftStore implements StrDraftStore {
  private readonly rows: StrDraft[] = []
  constructor(opts: { seedDemo?: boolean } = {}) {
    if (opts.seedDemo) {
      // Deterministic synthetic demo drafts (fixed UUIDs, no PII) so the STR queue is populated.
      this.rows.push(
        this.make('5f0e63c0-0000-4000-8000-0000000000a1', 'consent-demo-7741', 'Velocity anomaly: 6 revoke+re-grant cycles in 24h (synthetic).', 'demo:risk-analyst', '2026-06-20T08:00:00.000Z'),
        this.make('5f0e63c0-0000-4000-8000-0000000000a2', 'consent-demo-8852', 'CoP mismatch cluster across 3 fintechs (synthetic).', 'demo:risk-analyst', '2026-06-21T09:30:00.000Z')
      )
    }
  }
  private make(id: string, consentId: string, ctx: string, by: string, at: string): StrDraft {
    return { str_draft_id: id, source_consent_id: consentId, case_context: ctx, status: 'draft', created_by: by, approval_id: null, workflow_ref: null, approved_by: null, handed_off_at: null, created_at: at }
  }
  async record(input: StrDraftRecordInput): Promise<StrDraft> {
    const draft: StrDraft = {
      str_draft_id: crypto.randomUUID(),
      source_consent_id: input.source_consent_id,
      case_context: input.case_context,
      status: 'draft',
      created_by: input.created_by,
      approval_id: null,
      workflow_ref: null,
      approved_by: null,
      handed_off_at: null,
      created_at: new Date().toISOString()
    }
    this.rows.push(draft)
    return draft
  }
  async get(id: string): Promise<StrDraft | null> {
    return this.rows.find((r) => r.str_draft_id === id) ?? null
  }
  async list(query: StrDraftListQuery = {}): Promise<StrDraftPage> {
    let rows = [...this.rows].sort((a, b) => b.created_at.localeCompare(a.created_at))
    if (query.status) rows = rows.filter((r) => r.status === query.status)
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
    const slice = rows.slice(0, limit)
    const last = slice[slice.length - 1]
    const hasMore = rows.length > limit
    return { rows: slice, next_cursor: hasMore && last ? encodeCursor(last.created_at, last.str_draft_id) : null }
  }
  async markStatus(id: string, status: StrDraftStatus, patch: StrStatusPatch): Promise<StrDraft | null> {
    const r = this.rows.find((x) => x.str_draft_id === id)
    if (!r) return null
    r.status = status
    if (patch.approval_id !== undefined) r.approval_id = patch.approval_id
    if (patch.workflow_ref !== undefined) r.workflow_ref = patch.workflow_ref
    if (patch.approved_by !== undefined) r.approved_by = patch.approved_by
    if (patch.handed_off_at !== undefined) r.handed_off_at = patch.handed_off_at
    return r
  }
}
