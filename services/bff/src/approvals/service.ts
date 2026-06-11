import type { AuthAuditSink, Principal } from '../auth.js'
import { hasScope } from '../rbac.js'
import { addBusinessHours } from '../business-hours.js'

/**
 * BACKOFFICE-44: the shared four-eyes primitive. Gated operations are
 * registered here; they NEVER execute inline — callers create an approval
 * (202/201 + approval_request) and a SECOND authorised principal approves.
 * Self-approval is rejected at this service regardless of scope (incl. the
 * super admin, PRD §2 guardrail c). Expiry: 2 business hours (BD default),
 * weekends paused; expired requests revert to timed_out lazily.
 */

export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'timed_out'

export interface ApprovalRecord {
  approval_request_id: string
  operation_type: string
  operation_payload: Record<string, unknown>
  state: ApprovalState
  initiator: string
  approver_required_scope: string
  approver: string | null
  expires_at: string
  reject_reason: string | null
  execution_result?: unknown
}

export interface ApprovalStore {
  create(record: ApprovalRecord): Promise<void>
  get(id: string): Promise<ApprovalRecord | null>
  update(record: ApprovalRecord): Promise<void>
  listPending(): Promise<ApprovalRecord[]>
}

export class InMemoryApprovalStore implements ApprovalStore {
  private readonly rows = new Map<string, ApprovalRecord>()
  async create(r: ApprovalRecord) {
    this.rows.set(r.approval_request_id, structuredClone(r))
  }
  async get(id: string) {
    const r = this.rows.get(id)
    return r ? structuredClone(r) : null
  }
  async update(r: ApprovalRecord) {
    this.rows.set(r.approval_request_id, structuredClone(r))
  }
  async listPending() {
    return [...this.rows.values()].filter((r) => r.state === 'pending').map((r) => structuredClone(r))
  }
}

export interface GatedOperation {
  /** Scope required to INITIATE the operation — the spec's '(initiator scope)'. */
  initiatorScope: string
  approverScope: string
  execute(payload: Record<string, unknown>): Promise<unknown>
}

export class ApprovalError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409, readonly code: string, message: string) {
    super(message)
    this.name = 'ApprovalError'
  }
}

export interface ApprovalsDeps {
  store?: ApprovalStore
  operations?: Record<string, GatedOperation>
  now?: () => Date
  expiryBusinessHours?: number
}

export class ApprovalsService {
  private readonly store: ApprovalStore
  private readonly operations: Record<string, GatedOperation>
  private readonly now: () => Date
  private readonly expiryBusinessHours: number

  constructor(private readonly audit: AuthAuditSink, deps: ApprovalsDeps = {}) {
    this.store = deps.store ?? new InMemoryApprovalStore()
    this.operations = deps.operations ?? {}
    this.now = deps.now ?? (() => new Date())
    this.expiryBusinessHours = deps.expiryBusinessHours ?? 2
  }

  private async auditEvent(
    type: 'approval_requested' | 'approval_approved' | 'approval_rejected' | 'approval_timed_out',
    principal: Principal,
    approvalId: string,
    traceId: string
  ) {
    await this.audit.record({
      event_type: type,
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      reason: null,
      trace_id: traceId,
      superadmin_marker: principal.scopes.includes('platform:superadmin'),
      approval_request_id: approvalId
    })
  }

  /** Lazy expiry: a pending request past its window reverts to timed_out on touch — audited. */
  private async settleExpiry(r: ApprovalRecord, toucher: Principal, traceId: string): Promise<ApprovalRecord> {
    if (r.state === 'pending' && this.now().getTime() > new Date(r.expires_at).getTime()) {
      r.state = 'timed_out'
      await this.store.update(r)
      await this.auditEvent('approval_timed_out', toucher, r.approval_request_id, traceId)
    }
    return r
  }

  async requestApproval(
    principal: Principal,
    input: { operation_type: string; operation_payload: Record<string, unknown> },
    traceId: string
  ): Promise<ApprovalRecord> {
    const op = this.operations[input.operation_type]
    if (!op) {
      throw new ApprovalError(400, 'BACKOFFICE.UNKNOWN_OPERATION', `${input.operation_type} is not a registered four-eyes-gated operation.`)
    }
    // the spec's '(initiator scope)': only personas holding the operation's
    // initiator scope may request it (request-dependent enforcement, BACKOFFICE-43 rule)
    if (!hasScope(principal.scopes, op.initiatorScope)) {
      throw new ApprovalError(403, 'BACKOFFICE.SCOPE_DENIED', `initiating ${input.operation_type} requires ${op.initiatorScope}`)
    }
    const record: ApprovalRecord = {
      approval_request_id: crypto.randomUUID(),
      operation_type: input.operation_type,
      operation_payload: input.operation_payload,
      state: 'pending',
      initiator: principal.subject,
      approver_required_scope: op.approverScope,
      approver: null,
      expires_at: addBusinessHours(this.now(), this.expiryBusinessHours).toISOString(),
      reject_reason: null
    }
    await this.store.create(record)
    await this.auditEvent('approval_requested', principal, record.approval_request_id, traceId)
    return record
  }

  /** Spec: '(initiator or approver scope)' — only a party to the request may read it. */
  async getFor(principal: Principal, id: string, traceId: string): Promise<ApprovalRecord> {
    const r = await this.store.get(id)
    if (!r) throw new ApprovalError(404, 'BACKOFFICE.APPROVAL_NOT_FOUND', `approval ${id} does not exist`)
    const isParty = r.initiator === principal.subject || hasScope(principal.scopes, r.approver_required_scope)
    if (!isParty) throw new ApprovalError(403, 'BACKOFFICE.SCOPE_DENIED', 'reading an approval requires being its initiator or holding its approver scope')
    return this.settleExpiry(r, principal, traceId)
  }

  async listPendingFor(
    principal: Principal,
    traceId: string,
    page: { cursor?: string; limit?: number } = {}
  ): Promise<{ rows: ApprovalRecord[]; next_cursor: string | null }> {
    const limit = Math.min(Math.max(page.limit ?? 50, 1), 200)
    const settled = await Promise.all((await this.store.listPending()).map((r) => this.settleExpiry(r, principal, traceId)))
    const visible = settled
      .filter((r) => r.state === 'pending' && hasScope(principal.scopes, r.approver_required_scope))
      .sort((a, b) => a.approval_request_id.localeCompare(b.approval_request_id))
    const start = page.cursor ? visible.findIndex((r) => r.approval_request_id > page.cursor!) : 0
    const windowed = start < 0 ? [] : visible.slice(start, start + limit)
    const last = windowed.at(-1)
    const hasMore = start >= 0 && start + limit < visible.length
    return { rows: windowed, next_cursor: hasMore && last ? last.approval_request_id : null }
  }

  async approve(principal: Principal, id: string, traceId: string): Promise<ApprovalRecord> {
    const r = await this.getFor(principal, id, traceId)
    if (r.state === 'timed_out') throw new ApprovalError(409, 'BACKOFFICE.APPROVAL_EXPIRED', 'the approval window (2 business hours) has passed; the request timed out')
    if (r.state !== 'pending') throw new ApprovalError(409, 'BACKOFFICE.APPROVAL_NOT_PENDING', `approval is already ${r.state}`)
    // initiator ≠ approver, regardless of scope — incl. platform:superadmin
    if (r.initiator === principal.subject) throw new ApprovalError(409, 'BACKOFFICE.SELF_APPROVAL', 'the initiator cannot approve their own request (four-eyes)')
    if (!hasScope(principal.scopes, r.approver_required_scope)) {
      throw new ApprovalError(403, 'BACKOFFICE.SCOPE_DENIED', `approving requires ${r.approver_required_scope}`)
    }
    const op = this.operations[r.operation_type]
    if (!op) throw new ApprovalError(409, 'BACKOFFICE.OPERATION_UNREGISTERED', `${r.operation_type} has no registered executor — refusing to approve silently`)
    r.state = 'approved'
    r.approver = principal.subject
    r.execution_result = await op.execute(r.operation_payload)
    await this.store.update(r)
    await this.auditEvent('approval_approved', principal, r.approval_request_id, traceId)
    return r
  }

  async reject(principal: Principal, id: string, reason: string, traceId: string): Promise<ApprovalRecord> {
    if (!reason || reason.length < 10) throw new ApprovalError(400, 'BACKOFFICE.REJECT_REASON_REQUIRED', 'reject_reason must be at least 10 characters')
    const r = await this.getFor(principal, id, traceId)
    if (r.state !== 'pending') throw new ApprovalError(409, 'BACKOFFICE.APPROVAL_NOT_PENDING', `approval is already ${r.state}`)
    if (!hasScope(principal.scopes, r.approver_required_scope)) {
      throw new ApprovalError(403, 'BACKOFFICE.SCOPE_DENIED', `rejecting requires ${r.approver_required_scope}`)
    }
    r.state = 'rejected'
    r.approver = principal.subject
    r.reject_reason = reason
    await this.store.update(r)
    await this.auditEvent('approval_rejected', principal, r.approval_request_id, traceId)
    return r
  }
}

/** Wire shape per the spec's ApprovalRequest schema (operation payload stays internal/redacted). */
export function toWire(r: ApprovalRecord) {
  return {
    approval_request_id: r.approval_request_id,
    operation_type: r.operation_type,
    state: r.state,
    initiator: r.initiator,
    approver_required_scope: r.approver_required_scope,
    approver: r.approver,
    expires_at: r.expires_at,
    reject_reason: r.reject_reason,
    ...(r.execution_result !== undefined ? { execution_result: r.execution_result } : {})
  }
}
