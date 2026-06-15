import { describe, expect, it } from 'vitest'
import type { DisputePage, StoredDisputeRecord } from '@ofbo/db'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { DisputeService, type DisputeStore } from '../src/disputes/service.js'
import { mintScopes, type Principal } from '../src/auth.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-24 — complaint/dispute case-management lifecycle:
 * open → in_progress → escalated → resolved → closed, SLA timers per the complaint
 * SLA matrix, High-class audited. PATCH /disputes/{dispute_id}; disputes:admin.
 */

class FakeEgress {
  async createDisputeCase() {
    return { nebras_case_id: 'nebras-case-lifecycle' }
  }
  async revokeConsent() {
    return { acknowledged_in_ms: 1 }
  }
  async dispatchRefund() {
    return { ipp_status: 'ACSP' }
  }
}

const care = (extra: Record<string, string> = {}) => ({ ...FAPI_HEADERS, authorization: 'Bearer demo-token:customer-care-agent', 'content-type': 'application/json', ...extra })

function appWith() {
  const audit = new InMemoryHighClassAuditSink()
  return { app: createApp({ nebrasEgress: new FakeEgress(), highClassAudit: audit }), audit }
}

async function newDispute(app: ReturnType<typeof createApp>, key: string): Promise<string> {
  const res = await app.request('/disputes', { method: 'POST', headers: care({ 'idempotency-key': key }), body: JSON.stringify({ psu_identifier: 'BCID-CMP-1', dispute_type: 'consent_complaint' }) })
  return ((await res.json()) as { data: { id: string } }).data.id
}

const patch = (app: ReturnType<typeof createApp>, id: string, body: unknown, key: string) =>
  app.request(`/disputes/${id}`, { method: 'PATCH', headers: care({ 'idempotency-key': key }), body: JSON.stringify(body) })

describe('PATCH /disputes/{dispute_id} — complaint lifecycle (BACKOFFICE-24)', () => {
  it('walks open → in_progress → escalated → resolved → closed, auditing each transition', async () => {
    const { app, audit } = appWith()
    const id = await newDispute(app, 'n1')
    for (const [i, [state, extra]] of (
      [
        ['in_progress', {}],
        ['escalated', { escalated_to: 'tier2-complaints' }],
        ['resolved', { resolution_note: 'PSU confirmed; consent re-granted' }],
        ['closed', {}]
      ] as [string, Record<string, string>][]
    ).entries()) {
      const res = await patch(app, id, { state, ...extra }, `t${i}`)
      expect(res.status).toBe(200)
      expect(((await res.json()) as { data: { state: string } }).data.state).toBe(state)
    }
    const changes = audit.events.filter((e) => e.event_type === 'dispute_state_changed')
    expect(changes).toHaveLength(4)
    const first = changes[0]!.request_body as { from_state: string; to_state: string; sla_resolution_due_at: string }
    expect(first.from_state).toBe('open')
    expect(first.to_state).toBe('in_progress')
    expect(first.sla_resolution_due_at).toBeTruthy() // SLA deadline computed from the matrix
    // escalated_to + resolution_note captured in the audit trail
    const escalation = changes.find((c) => (c.request_body as { to_state: string }).to_state === 'escalated')!
    expect((escalation.request_body as { escalated_to: string }).escalated_to).toBe('tier2-complaints')
    const resolution = changes.find((c) => (c.request_body as { to_state: string }).to_state === 'resolved')!
    expect((resolution.request_body as { resolution_note: string }).resolution_note).toContain('re-granted')
  })

  it('rejects illegal transitions (409) and refund_initiated via PATCH (409), and a bad state (400)', async () => {
    const { app } = appWith()
    const id = await newDispute(app, 'n2')
    // open → resolved is not a legal step
    expect((await patch(app, id, { state: 'resolved' }, 'i1')).status).toBe(409)
    // refund_initiated is reserved for the four-eyes refund flow
    expect((await patch(app, id, { state: 'refund_initiated' }, 'i2')).status).toBe(409)
    // unknown state value
    expect((await patch(app, id, { state: 'archived' }, 'i3')).status).toBe(400)
  })

  it('enforces disputes:admin (403), Idempotency-Key (400), and 404s an unknown case', async () => {
    const { app } = appWith()
    const id = await newDispute(app, 'n3')
    // 403 — finance-analyst lacks disputes:admin
    const denied = await app.request(`/disputes/${id}`, { method: 'PATCH', headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst', 'content-type': 'application/json', 'idempotency-key': 'd1' }, body: JSON.stringify({ state: 'in_progress' }) })
    expect(denied.status).toBe(403)
    // 400 — missing Idempotency-Key
    expect((await app.request(`/disputes/${id}`, { method: 'PATCH', headers: care(), body: JSON.stringify({ state: 'in_progress' }) })).status).toBe(400)
    // 404 — unknown dispute
    expect((await patch(app, '4d2c2e2a-0000-4000-8000-000000000000', { state: 'in_progress' }, 'd2')).status).toBe(404)
  })

  it('replays the same Idempotency-Key verbatim (no second transition audit)', async () => {
    const { app, audit } = appWith()
    const id = await newDispute(app, 'n4')
    await patch(app, id, { state: 'in_progress' }, 'k')
    const before = audit.events.filter((e) => e.event_type === 'dispute_state_changed').length
    const replay = await patch(app, id, { state: 'in_progress' }, 'k')
    expect(replay.status).toBe(200)
    expect(audit.events.filter((e) => e.event_type === 'dispute_state_changed').length).toBe(before)
  })

  it('flags an SLA breach when the resolution deadline has passed (service-level)', async () => {
    const audit = new InMemoryHighClassAuditSink()
    // a consent_complaint opened 30 days ago → well past the 5-business-day SLA
    const stale: StoredDisputeRecord = {
      id: 'dsp-stale', psu_identifier: 'BCID-X', dispute_type: 'consent_complaint', state: 'in_progress',
      originating_payment_id: null, originating_consent_id: null, originating_call_id: null, dispute_reason_code: null,
      sla_clock_started_at: '2026-05-01T00:00:00.000Z', refund_required_by: null, refund_initiated_at: null,
      refund_amount: null, nebras_case_id: null, care_case_id: null, assigned_to: null, created_at: '2026-05-01T00:00:00.000Z'
    }
    const store: DisputeStore = {
      async create() { return stale },
      async get() { return stale },
      async list(): Promise<DisputePage> { return { rows: [stale], next_cursor: null } },
      async markRefundInitiated(): Promise<StoredDisputeRecord | null> { return stale },
      async updateState() { return { ...stale, state: 'escalated' } }
    }
    const svc = new DisputeService({
      store,
      payments: { get: () => null, byPsu: () => [] },
      egress: new FakeEgress(),
      audit,
      approvals: { requestApproval: async () => ({}) as never }
    })
    const principal: Principal = { subject: 'demo:care', persona: 'customer-care-agent', scopes: mintScopes('customer-care-agent') }
    await svc.updateState(principal, 'dsp-stale', { state: 'escalated', escalated_to: 'tier2' }, 't')
    const ev = audit.events.find((e) => e.event_type === 'dispute_state_changed')!
    expect((ev.request_body as { sla_breached: boolean }).sla_breached).toBe(true)
  })
})
