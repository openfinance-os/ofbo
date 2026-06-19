import { describe, expect, it } from 'vitest'
import { generateDemoDataset } from '@ofbo/synthetic-data'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-76 — cross-scheme dispute guard (Aani / Al Tareq). Record cross-scheme
 * context on a PSU-raised dispute; the double-compensation guard blocks an
 * initiate-refund once the same direct loss is settled in the other scheme.
 */

const ds = generateDemoDataset()
const psu = ds.psus.find((p) => p.payments.length > 0)!
const payment = psu.payments[0]!

class FakeEgress {
  async createDisputeCase() {
    return { nebras_case_id: 'nebras-cs-1' }
  }
  async dispatchRefund() {
    return { ipp_status: 'ACSP' as const }
  }
  async revokeConsent() {
    return { acknowledged_in_ms: 10 }
  }
}

const care = (extra: Record<string, string> = {}) => ({ ...FAPI_HEADERS, authorization: 'Bearer demo-token:customer-care-agent', 'content-type': 'application/json', ...extra })

function appWith() {
  const audit = new InMemoryHighClassAuditSink()
  return { app: createApp({ highClassAudit: audit, nebrasEgress: new FakeEgress() }), audit }
}

const disputeBody = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ psu_identifier: psu.bank_customer_id, dispute_type: 'unauthorised_payment', originating_payment_id: payment.payment_id, ...extra })

type Dispute = {
  id: string
  aani_case_id: string | null
  cross_scheme: { aani_case_id: string | null; settled_in_other_scheme: boolean; compensation_blocked: boolean; aani_recall_window_expires_at: string | null; sanadak_reference: string | null } | null
}

async function newDispute(app: ReturnType<typeof createApp>, key: string, extra: Record<string, unknown> = {}): Promise<Dispute> {
  const res = await app.request('/disputes', { method: 'POST', headers: care({ 'idempotency-key': key }), body: disputeBody(extra) })
  expect(res.status).toBe(201)
  return ((await res.json()) as { data: Dispute }).data
}

const recordCs = (app: ReturnType<typeof createApp>, id: string, payload: Record<string, unknown>, key: string) =>
  app.request(`/back-office/disputes/${id}:record-cross-scheme`, { method: 'POST', headers: care({ 'idempotency-key': key }), body: JSON.stringify(payload) })

describe('POST /back-office/disputes/{id}:record-cross-scheme', () => {
  it('records the Aani case + Sanadak escalation and arms the guard on settled_in_other_scheme', async () => {
    const { app, audit } = appWith()
    const d = await newDispute(app, 'x1')
    audit.events.length = 0
    const res = await recordCs(app, d.id, { aani_case_id: 'AANI-123', settled_in_other_scheme: true, sanadak_reference: 'SAN-9' }, 'cs1')
    expect(res.status).toBe(200)
    const cs = ((await res.json()) as { data: Dispute }).data.cross_scheme!
    expect(cs.aani_case_id).toBe('AANI-123')
    expect(cs.settled_in_other_scheme).toBe(true)
    expect(cs.compensation_blocked).toBe(true)
    expect(cs.aani_recall_window_expires_at).not.toBeNull()
    expect(cs.sanadak_reference).toBe('SAN-9')
    expect(audit.events.filter((e) => e.event_type === 'dispute_cross_scheme_recorded')).toHaveLength(1)
  })

  it('the double-compensation guard blocks initiate-refund (409) once settled in the other scheme', async () => {
    const { app } = appWith()
    const d = await newDispute(app, 'x2')
    // refund works before the guard is armed (four-eyes 202)
    const before = await app.request(`/disputes/${d.id}:initiate-refund`, { method: 'POST', headers: care({ 'idempotency-key': 'r-before' }), body: JSON.stringify({ refund_amount: { amount: 5000, currency: 'AED' } }) })
    expect(before.status).toBe(202)
    await recordCs(app, d.id, { settled_in_other_scheme: true }, 'cs2')
    const after = await app.request(`/disputes/${d.id}:initiate-refund`, { method: 'POST', headers: care({ 'idempotency-key': 'r-after' }), body: JSON.stringify({ refund_amount: { amount: 5000, currency: 'AED' } }) })
    expect(after.status).toBe(409)
  })

  it('create carries aani_case_id onto the DisputeCase + cross_scheme', async () => {
    const { app } = appWith()
    const d = await newDispute(app, 'x3', { aani_case_id: 'AANI-AT-CREATE' })
    expect(d.aani_case_id).toBe('AANI-AT-CREATE')
    expect(d.cross_scheme?.aani_case_id).toBe('AANI-AT-CREATE')
  })

  it('404 unknown dispute, 400 without Idempotency-Key, 403 wrong scope', async () => {
    const { app } = appWith()
    const d = await newDispute(app, 'x4')
    expect((await recordCs(app, '4d2c2e2a-0000-4000-8000-000000000000', { aani_case_id: 'A' }, 'cs4')).status).toBe(404)
    expect((await app.request(`/back-office/disputes/${d.id}:record-cross-scheme`, { method: 'POST', headers: care(), body: JSON.stringify({ aani_case_id: 'A' }) })).status).toBe(400)
    expect((await app.request(`/back-office/disputes/${d.id}:record-cross-scheme`, { method: 'POST', headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst', 'content-type': 'application/json', 'idempotency-key': 'cs5' }, body: JSON.stringify({ aani_case_id: 'A' }) })).status).toBe(403)
  })
})
