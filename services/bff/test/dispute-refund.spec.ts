import { describe, expect, it } from 'vitest'
import { generateDemoDataset } from '@ofbo/synthetic-data'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-21 — next-business-day refund, four-eyes-gated. Initiation returns
 * 202 + approval_request (never executes inline); a DIFFERENT disputes:admin
 * principal approves, which moves the dispute to refund_initiated with the SLA
 * deadline recorded. The demo subject is per-persona, so the approver is the
 * super-admin (distinct subject, holds disputes:admin via the union).
 */

const psu = generateDemoDataset().psus[0]!

class FakeEgress {
  async createDisputeCase() {
    return { nebras_case_id: 'nebras-refund-test' }
  }
  async revokeConsent() {
    return { acknowledged_in_ms: 420 }
  }
}

const care = (extra: Record<string, string> = {}) => ({
  ...FAPI_HEADERS,
  authorization: 'Bearer demo-token:customer-care-agent',
  'content-type': 'application/json',
  ...extra
})
const superAdmin = (extra: Record<string, string> = {}) => ({
  ...FAPI_HEADERS,
  authorization: 'Bearer demo-token:platform-super-admin',
  'x-superadmin-justification': 'four-eyes approval of a next-business-day refund (test)',
  'content-type': 'application/json',
  ...extra
})

function appWith() {
  const audit = new InMemoryHighClassAuditSink()
  return { app: createApp({ nebrasEgress: new FakeEgress(), highClassAudit: audit }), audit }
}

async function createDispute(app: ReturnType<typeof createApp>): Promise<string> {
  const res = await app.request('/disputes', {
    method: 'POST',
    headers: care({ 'idempotency-key': `c-${crypto.randomUUID()}` }),
    body: JSON.stringify({ psu_identifier: psu.bank_customer_id, dispute_type: 'unauthorised_payment' })
  })
  return ((await res.json()) as { data: { id: string } }).data.id
}

const refund = () => JSON.stringify({ refund_amount: { amount: 150000, currency: 'AED' } })

describe('POST /disputes/{dispute_id}:initiate-refund', () => {
  it('is four-eyes-gated: returns 202 + a pending approval_request, does not refund inline', async () => {
    const { app } = appWith()
    const id = await createDispute(app)
    const res = await app.request(`/disputes/${id}:initiate-refund`, {
      method: 'POST',
      headers: care({ 'idempotency-key': 'r1' }),
      body: refund()
    })
    expect(res.status).toBe(202)
    const ar = (await res.json()) as { data: { approval_request_id: string; state: string; operation_type: string } }
    expect(ar.data.state).toBe('pending')
    expect(ar.data.operation_type).toBe('disputes.initiate_refund')

    // not yet refunded — still open
    const list = await app.request(`/disputes?psu_identifier=${psu.bank_customer_id}`, { headers: care() })
    const d = ((await list.json()) as { data: Array<{ id: string; state: string }> }).data.find((x) => x.id === id)
    expect(d?.state).toBe('open')
  })

  it('executes the refund only when a different principal approves (state → refund_initiated, SLA recorded)', async () => {
    const { app, audit } = appWith()
    const id = await createDispute(app)
    const init = await app.request(`/disputes/${id}:initiate-refund`, { method: 'POST', headers: care({ 'idempotency-key': 'r2' }), body: refund() })
    const approvalId = ((await init.json()) as { data: { approval_request_id: string } }).data.approval_request_id

    // self-approval (same subject) is rejected — four-eyes
    const self = await app.request(`/approvals/${approvalId}:approve`, { method: 'POST', headers: care({ 'idempotency-key': 'a-self' }) })
    expect(self.status).toBe(409)

    // a different disputes:admin principal (super-admin) approves → executes
    const ok = await app.request(`/approvals/${approvalId}:approve`, { method: 'POST', headers: superAdmin({ 'idempotency-key': 'a-ok' }) })
    expect(ok.status).toBe(200)

    const list = await app.request(`/disputes?psu_identifier=${psu.bank_customer_id}`, { headers: care() })
    const d = ((await list.json()) as { data: Array<{ id: string; state: string; refund_required_by: string | null; refund_amount: { amount: number } | null }> }).data.find((x) => x.id === id)
    expect(d?.state).toBe('refund_initiated')
    expect(d?.refund_required_by).toBeTruthy() // next-business-day SLA deadline
    expect(d?.refund_amount?.amount).toBe(150000)
    expect(audit.events.some((e) => e.event_type === 'refund_initiated' && e.target_dispute_id === id)).toBe(true)
  })

  it('400 on missing/!integer refund_amount; 400 without Idempotency-Key; 404 unknown dispute', async () => {
    const { app } = appWith()
    const id = await createDispute(app)
    expect((await app.request(`/disputes/${id}:initiate-refund`, { method: 'POST', headers: care({ 'idempotency-key': 'r3' }), body: JSON.stringify({}) })).status).toBe(400)
    expect((await app.request(`/disputes/${id}:initiate-refund`, { method: 'POST', headers: care({ 'idempotency-key': 'r4' }), body: JSON.stringify({ refund_amount: { amount: 1.5, currency: 'AED' } }) })).status).toBe(400)
    expect((await app.request(`/disputes/${id}:initiate-refund`, { method: 'POST', headers: care(), body: refund() })).status).toBe(400) // no idempotency-key
    expect((await app.request(`/disputes/${'0'.repeat(8)}-0000-4000-8000-000000000000:initiate-refund`, { method: 'POST', headers: care({ 'idempotency-key': 'r5' }), body: refund() })).status).toBe(404)
  })

  it('rejects a persona without disputes:admin (403)', async () => {
    const { app } = appWith()
    const id = await createDispute(app)
    const res = await app.request(`/disputes/${id}:initiate-refund`, {
      method: 'POST',
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst', 'content-type': 'application/json', 'idempotency-key': 'r6' },
      body: refund()
    })
    expect(res.status).toBe(403)
  })
})
