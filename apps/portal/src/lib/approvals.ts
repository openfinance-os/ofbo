/**
 * UI-05 — Four-Eyes Approval Portal data layer (BACKOFFICE-44 approvals primitive).
 * Calls the Hono BFF over the OpenAPI contract paths, SERVER-SIDE only (Bearer from
 * the httpOnly cookie, never exposed to the browser). fetch + base URL are injectable
 * for unit tests. Behaviour/data = the contract; appearance = the Stitch screen.
 *
 * The portal NEVER executes a four-eyes operation inline: it only lists pending
 * requests, reads one, and approves/rejects. Execution happens BFF-side on approval
 * by a second, differently-authorised principal (initiator ≠ approver).
 */

import { bffClient } from './bff'
import type { Schemas, KeysConformToContract, AssertContract } from './contract-types'

export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'timed_out'

/** Mirrors the OpenAPI ApprovalRequest wire shape (no operation_payload — PII-redacted). */
export interface ApprovalRequest {
  approval_request_id: string
  operation_type: string
  state: ApprovalState
  initiator: string
  approver_required_scope: string
  approver: string | null
  expires_at: string
  reject_reason: string | null
  execution_result?: unknown
}

/** A reject reason must be at least this many characters (BFF-enforced). */
export const MIN_REJECT_REASON = 10

export class ApprovalApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface ApprovalApiDeps {
  baseUrl?: string
  fetchImpl?: typeof fetch
  traceId?: string
}

function resolve(deps: ApprovalApiDeps) {
  return {
    ...bffClient(deps),
    trace: deps.traceId ?? crypto.randomUUID()
  }
}

async function envelope<T>(res: Response): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: { code?: string; message?: string }; meta?: Record<string, unknown> }
  if (!res.ok) throw new ApprovalApiError(body.error?.code ?? 'BACKOFFICE.ERROR', body.error?.message ?? `HTTP ${res.status}`, res.status)
  return { data: body.data as T, meta: body.meta }
}

const authHeaders = (token: string, trace: string) => ({ authorization: `Bearer ${token}`, 'x-fapi-interaction-id': trace })

/** GET /approvals/pending — pending requests the caller holds approver_required_scope for. */
export async function listPendingApprovals(token: string, deps: ApprovalApiDeps = {}): Promise<{ approvals: ApprovalRequest[]; next_cursor: string | null }> {
  const { base, f, trace } = resolve(deps)
  const res = await f(`${base}/approvals/pending`, { headers: authHeaders(token, trace) })
  const { data, meta } = await envelope<ApprovalRequest[]>(res)
  return { approvals: data ?? [], next_cursor: (meta?.next_cursor as string | null) ?? null }
}

/** GET /approvals/{id} — read one request (initiator or approver scope). */
export async function getApproval(token: string, approvalId: string, deps: ApprovalApiDeps = {}): Promise<ApprovalRequest> {
  const { base, f, trace } = resolve(deps)
  const res = await f(`${base}/approvals/${encodeURIComponent(approvalId)}`, { headers: authHeaders(token, trace) })
  return (await envelope<ApprovalRequest>(res)).data
}

/**
 * POST /approvals/{id}:approve — a second authorised principal approves; the BFF
 * executes the gated operation on approval (initiator ≠ approver, enforced BFF-side).
 * Mutating → Idempotency-Key mandatory.
 */
export async function approveRequest(token: string, approvalId: string, idempotencyKey: string, deps: ApprovalApiDeps = {}): Promise<ApprovalRequest> {
  const { base, f, trace } = resolve(deps)
  const res = await f(`${base}/approvals/${encodeURIComponent(approvalId)}:approve`, {
    method: 'POST',
    headers: { ...authHeaders(token, trace), 'idempotency-key': idempotencyKey }
  })
  return (await envelope<ApprovalRequest>(res)).data
}

/** POST /approvals/{id}:reject — reject with a reason (≥ MIN_REJECT_REASON). Mutating → Idempotency-Key. */
export async function rejectRequest(token: string, approvalId: string, rejectReason: string, idempotencyKey: string, deps: ApprovalApiDeps = {}): Promise<ApprovalRequest> {
  const { base, f, trace } = resolve(deps)
  const res = await f(`${base}/approvals/${encodeURIComponent(approvalId)}:reject`, {
    method: 'POST',
    headers: { ...authHeaders(token, trace), 'idempotency-key': idempotencyKey, 'content-type': 'application/json' },
    body: JSON.stringify({ reject_reason: rejectReason })
  })
  return (await envelope<ApprovalRequest>(res)).data
}

/**
 * Can THIS principal approve/reject the request? Four-eyes: the request must be
 * pending, the principal must NOT be the initiator (no self-approval — enforced
 * BFF-side too, incl. superadmin), and must hold the approver scope (superadmin marker
 * satisfies any scope, mirroring the BFF hasScope).
 */
export function canActOn(approval: ApprovalRequest, subject: string, scopes: readonly string[], superadmin: boolean): boolean {
  if (approval.state !== 'pending') return false
  if (approval.initiator === subject) return false
  return superadmin || scopes.includes(approval.approver_required_scope)
}

// ADR-0004 drift guard — fails typecheck if the contract renames/removes an ApprovalRequest
// field. `execution_result` is a portal-side augmentation (the executed operation's result
// surfaced post-approval), intentionally absent from the contract schema, so it's excluded.
export type ApprovalRequestContractGuard = AssertContract<KeysConformToContract<Omit<ApprovalRequest, 'execution_result'>, Schemas['ApprovalRequest']>>
