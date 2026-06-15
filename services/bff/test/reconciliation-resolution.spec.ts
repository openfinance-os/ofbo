import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { InMemoryReconciliationBreakStore, InMemoryReconciliationLogStore, ReconciliationService } from '../src/reconciliation/service.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-04 — resolution outcomes (terminal transition + mandatory note,
 * immutable audit) and four-eyes reopen (Compliance scope + justification).
 */

const WINDOW = { start: '2026-07-14T00:00:00.000Z', end: '2026-07-15T00:00:00.000Z' }
const NOTE = 'Confirmed Nebras under-billed; internal metering is authoritative.' // ≥20 chars
const JUSTIFY = 'Compliance review found the resolution premature; reopening for re-investigation.'

class FakeItsm {
  async createTicket() {
    return { ticket_id: 't' }
  }
}
const finance = (extra: Record<string, string> = {}) => ({ ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst', 'content-type': 'application/json', ...extra })
const compliance = (extra: Record<string, string> = {}) => ({ ...FAPI_HEADERS, authorization: 'Bearer demo-token:compliance-officer', 'content-type': 'application/json', ...extra })
const superAdmin = (extra: Record<string, string> = {}) => ({ ...FAPI_HEADERS, authorization: 'Bearer demo-token:platform-super-admin', 'x-superadmin-justification': 'four-eyes approval of a reconciliation break reopen (test)', 'content-type': 'application/json', ...extra })

describe('break resolution + reopen', () => {
  const breakStore = new InMemoryReconciliationBreakStore()
  const audit = new InMemoryHighClassAuditSink()
  let app: ReturnType<typeof createApp>
  let ids: string[]

  beforeAll(async () => {
    const svc = new ReconciliationService({ store: new InMemoryReconciliationLogStore(), breakStore, itsm: new FakeItsm(), audit: new InMemoryHighClassAuditSink() })
    await svc.runDaily('seed', { window: WINDOW })
    app = createApp({ reconciliationBreakStore: breakStore, highClassAudit: audit })
    ids = (await breakStore.list({})).rows.map((r) => r.id)
  })

  it('resolves a break to a terminal outcome with a mandatory note + immutable audit', async () => {
    const id = ids[0]!
    const res = await app.request(`/back-office/reconciliation/breaks/${id}/resolve`, {
      method: 'POST',
      headers: finance({ 'idempotency-key': 'r1' }),
      body: JSON.stringify({ resolution_outcome: 'resolved_matched', resolution_note: NOTE })
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { status: string; resolution_outcome: string; resolution_note: string } }
    expect(body.data.status).toBe('resolved_matched')
    expect(body.data.resolution_outcome).toBe('resolved_matched')
    const ev = audit.events.find((e) => e.event_type === 'reconciliation_break_resolved')
    expect((ev?.request_body as { break_id: string }).break_id).toBe(id)
  })

  it('rejects a short note (<20), an invalid outcome, and re-resolving a terminal break', async () => {
    const fresh = ids[1]!
    expect((await app.request(`/back-office/reconciliation/breaks/${fresh}/resolve`, { method: 'POST', headers: finance({ 'idempotency-key': 'r2' }), body: JSON.stringify({ resolution_outcome: 'resolved_matched', resolution_note: 'too short' }) })).status).toBe(400)
    expect((await app.request(`/back-office/reconciliation/breaks/${fresh}/resolve`, { method: 'POST', headers: finance({ 'idempotency-key': 'r3' }), body: JSON.stringify({ resolution_outcome: 'escalated_nebras_dispute', resolution_note: NOTE }) })).status).toBe(400) // not a resolve outcome
    // resolve it, then re-resolve → 409
    await app.request(`/back-office/reconciliation/breaks/${fresh}/resolve`, { method: 'POST', headers: finance({ 'idempotency-key': 'r4' }), body: JSON.stringify({ resolution_outcome: 'resolved_internal_correction', resolution_note: NOTE }) })
    const again = await app.request(`/back-office/reconciliation/breaks/${fresh}/resolve`, { method: 'POST', headers: finance({ 'idempotency-key': 'r5' }), body: JSON.stringify({ resolution_outcome: 'resolved_matched', resolution_note: NOTE }) })
    expect(again.status).toBe(409)
  })

  it('rejects resolve without finance:reconciliation:write (403)', async () => {
    const res = await app.request(`/back-office/reconciliation/breaks/${ids[2]}/resolve`, {
      method: 'POST',
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:customer-care-agent', 'content-type': 'application/json', 'idempotency-key': 'r6' },
      body: JSON.stringify({ resolution_outcome: 'resolved_matched', resolution_note: NOTE })
    })
    expect(res.status).toBe(403)
  })

  it('reopen is four-eyes: 202 + pending, executes only on a different audit:read principal’s approval', async () => {
    const id = ids[2]!
    // resolve first so it is reopenable
    await app.request(`/back-office/reconciliation/breaks/${id}/resolve`, { method: 'POST', headers: finance({ 'idempotency-key': 'rr-res' }), body: JSON.stringify({ resolution_outcome: 'resolved_matched', resolution_note: NOTE }) })

    const init = await app.request(`/back-office/reconciliation/breaks/${id}/reopen`, { method: 'POST', headers: compliance({ 'idempotency-key': 'rr1' }), body: JSON.stringify({ justification: JUSTIFY }) })
    expect(init.status).toBe(202)
    const ar = (await init.json()) as { data: { state: string; operation_type: string; approval_request_id: string } }
    expect(ar.data.state).toBe('pending')
    expect(ar.data.operation_type).toBe('reconciliation.break_reopen')

    // self-approval rejected (four-eyes)
    const self = await app.request(`/approvals/${ar.data.approval_request_id}:approve`, { method: 'POST', headers: compliance({ 'idempotency-key': 'rr-self' }) })
    expect(self.status).toBe(409)

    // a different audit:read principal approves → break reopened
    const ok = await app.request(`/approvals/${ar.data.approval_request_id}:approve`, { method: 'POST', headers: superAdmin({ 'idempotency-key': 'rr-ok' }) })
    expect(ok.status).toBe(200)
    const exec = ((await ok.json()) as { data: { execution_result?: { reopened?: boolean; status?: string; reopened_count?: number } } }).data.execution_result
    expect(exec?.reopened).toBe(true)
    expect(exec?.status).toBe('flagged')
    expect(exec?.reopened_count).toBe(1)
    const reopened = await breakStore.get(id)
    expect(reopened?.status).toBe('flagged')
    expect(reopened?.reopened_count).toBe(1)
  })

  it('400 short justification; 409 reopening a non-resolved break; 403 without audit:read', async () => {
    const flagged = ids[3]! // still flagged (never resolved)
    expect((await app.request(`/back-office/reconciliation/breaks/${flagged}/reopen`, { method: 'POST', headers: compliance({ 'idempotency-key': 'rr2' }), body: JSON.stringify({ justification: 'too short' }) })).status).toBe(400)
    expect((await app.request(`/back-office/reconciliation/breaks/${flagged}/reopen`, { method: 'POST', headers: compliance({ 'idempotency-key': 'rr3' }), body: JSON.stringify({ justification: JUSTIFY }) })).status).toBe(409)
    expect((await app.request(`/back-office/reconciliation/breaks/${flagged}/reopen`, { method: 'POST', headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst', 'content-type': 'application/json', 'idempotency-key': 'rr4' }, body: JSON.stringify({ justification: JUSTIFY }) })).status).toBe(403) // finance lacks audit:read
  })
})
