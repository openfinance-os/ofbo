import { describe, expect, it, vi } from 'vitest'
import { approveRequest, canActOn, getApproval, listPendingApprovals, rejectRequest, ApprovalApiError, type ApprovalRequest } from '../src/lib/approvals.js'

/**
 * UI-05 — Four-Eyes Approval Portal client (BACKOFFICE-44). Asserts the contract paths,
 * Bearer + x-fapi-interaction-id propagation, the Idempotency-Key on every mutation, the
 * {data}/{error} envelope, and the four-eyes canActOn rule (no self-approval, scope-gated).
 */

const BASE = 'http://bff.test'
const TOKEN = 'demo-token:finance-analyst'

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const pending: ApprovalRequest = {
  approval_request_id: 'ap-1',
  operation_type: 'consents.fraud_revoke',
  state: 'pending',
  initiator: 'demo:risk',
  approver_required_scope: 'risk:read',
  approver: null,
  expires_at: '2026-06-17T12:00:00Z',
  reject_reason: null
}

describe('approvals client', () => {
  it('GETs /approvals/pending and returns rows + next_cursor', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ data: [pending], meta: { next_cursor: null } }))
    const out = await listPendingApprovals(TOKEN, { baseUrl: BASE, fetchImpl, traceId: 't1' })
    expect(out.approvals).toHaveLength(1)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(`${BASE}/approvals/pending`)
    expect(init!.headers).toMatchObject({ authorization: `Bearer ${TOKEN}`, 'x-fapi-interaction-id': 't1' })
  })

  it('GETs /approvals/{id}', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ data: pending }))
    const out = await getApproval(TOKEN, 'ap-1', { baseUrl: BASE, fetchImpl })
    expect(out.approval_request_id).toBe('ap-1')
    expect(fetchImpl.mock.calls[0]![0]).toBe(`${BASE}/approvals/ap-1`)
  })

  it('POSTs :approve with a mandatory Idempotency-Key', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ data: { ...pending, state: 'approved', approver: 'demo:risk2' } }))
    const out = await approveRequest(TOKEN, 'ap-1', 'idem-1', { baseUrl: BASE, fetchImpl })
    expect(out.state).toBe('approved')
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(`${BASE}/approvals/ap-1:approve`)
    expect(init!.method).toBe('POST')
    expect(init!.headers).toMatchObject({ 'idempotency-key': 'idem-1' })
  })

  it('POSTs :reject with reject_reason and an Idempotency-Key', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ data: { ...pending, state: 'rejected', reject_reason: 'not warranted now' } }))
    const out = await rejectRequest(TOKEN, 'ap-1', 'not warranted now', 'idem-2', { baseUrl: BASE, fetchImpl })
    expect(out.state).toBe('rejected')
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(`${BASE}/approvals/ap-1:reject`)
    expect(init!.method).toBe('POST')
    expect(JSON.parse(init!.body as string)).toEqual({ reject_reason: 'not warranted now' })
    expect(init!.headers).toMatchObject({ 'idempotency-key': 'idem-2' })
  })

  it('maps a non-2xx to a typed ApprovalApiError', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ error: { code: 'BACKOFFICE.SELF_APPROVAL', message: 'no' } }, 409))
    await expect(approveRequest(TOKEN, 'ap-1', 'i', { baseUrl: BASE, fetchImpl })).rejects.toMatchObject({ code: 'BACKOFFICE.SELF_APPROVAL', status: 409 })
    await expect(approveRequest(TOKEN, 'ap-1', 'i', { baseUrl: BASE, fetchImpl })).rejects.toBeInstanceOf(ApprovalApiError)
  })
})

describe('canActOn — four-eyes rule', () => {
  it('allows a non-initiator holding the approver scope', () => {
    expect(canActOn(pending, 'demo:risk2', ['risk:read'], false)).toBe(true)
  })
  it('blocks the initiator (no self-approval) even with the scope', () => {
    expect(canActOn(pending, 'demo:risk', ['risk:read'], false)).toBe(false)
  })
  it('blocks a principal lacking the approver scope', () => {
    expect(canActOn(pending, 'demo:other', ['billing:read'], false)).toBe(false)
  })
  it('lets superadmin act (marker satisfies the scope) but still not self-approve', () => {
    expect(canActOn(pending, 'demo:sa', [], true)).toBe(true)
    expect(canActOn({ ...pending, initiator: 'demo:sa' }, 'demo:sa', [], true)).toBe(false)
  })
  it('blocks acting on a non-pending request', () => {
    expect(canActOn({ ...pending, state: 'approved' }, 'demo:risk2', ['risk:read'], false)).toBe(false)
  })
})
