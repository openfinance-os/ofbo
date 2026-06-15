import { describe, expect, it } from 'vitest'
import { generateDemoDataset } from '@ofbo/synthetic-data'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-20 — unauthorised-payment investigation: payment admin view +
 * one-click dispute creation (Nebras-linked, audited, Idempotency-Key), list,
 * get. disputes:admin enforced at the BFF layer.
 */

const ds = generateDemoDataset()
const psu = ds.psus[0]!
const payment = psu.payments[0]!

class FakeEgress {
  disputeCalls = 0
  async createDisputeCase(_payload: Record<string, unknown>) {
    this.disputeCalls++
    return { nebras_case_id: 'nebras-case-test-1' }
  }
  async revokeConsent() {
    return { acknowledged_in_ms: 420 }
  }
  async dispatchRefund() {
    return { ipp_status: 'ACSP' }
  }
}

const care = (extra: Record<string, string> = {}) => ({
  ...FAPI_HEADERS,
  authorization: 'Bearer demo-token:customer-care-agent',
  'content-type': 'application/json',
  ...extra
})

function appWith() {
  const audit = new InMemoryHighClassAuditSink()
  const egress = new FakeEgress()
  return { app: createApp({ nebrasEgress: egress, highClassAudit: audit }), audit, egress }
}

describe('GET /payments/{payment_id}:admin', () => {
  it('returns the payment investigation view incl. consent-validity-at-time-of-payment', async () => {
    const { app } = appWith()
    const res = await app.request(`/payments/${payment.payment_id}:admin`, { headers: care() })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { payment_id: string; ipp_status: string; consent_at_time_of_payment: { consent_id: string } | null; psu_identifier?: string }
    }
    expect(body.data.payment_id).toBe(payment.payment_id)
    expect(body.data.ipp_status).toBe(payment.ipp_status)
    expect(body.data.consent_at_time_of_payment?.consent_id).toBe(payment.originating_consent_id)
    expect(body.data.psu_identifier).toBeUndefined() // internal id not leaked to the wire
  })

  it('404s an unknown payment and 403s a persona without disputes:admin', async () => {
    const { app } = appWith()
    expect((await app.request(`/payments/${'0'.repeat(8)}-0000-4000-8000-000000000000:admin`, { headers: care() })).status).toBe(404)
    const denied = await app.request(`/payments/${payment.payment_id}:admin`, {
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst' }
    })
    expect(denied.status).toBe(403)
  })
})

const disputeBody = () =>
  JSON.stringify({ psu_identifier: psu.bank_customer_id, dispute_type: 'unauthorised_payment', originating_payment_id: payment.payment_id })

describe('POST /disputes', () => {
  it('creates a Nebras-linked dispute (201) and writes one dispute_created audit', async () => {
    const { app, audit, egress } = appWith()
    const res = await app.request('/disputes', { method: 'POST', headers: care({ 'idempotency-key': 'd1' }), body: disputeBody() })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: { id: string; state: string; dispute_type: string; nebras_case_id: string } }
    expect(body.data.state).toBe('open')
    expect(body.data.dispute_type).toBe('unauthorised_payment')
    expect(body.data.nebras_case_id).toBe('nebras-case-test-1')
    expect(egress.disputeCalls).toBe(1)
    expect(audit.events).toHaveLength(1)
    expect(audit.events[0]).toMatchObject({ event_type: 'dispute_created', target_psu_identifier: psu.bank_customer_id, target_dispute_id: body.data.id })
  })

  it('requires Idempotency-Key (400) and replays without a duplicate Nebras case', async () => {
    const { app, egress } = appWith()
    expect((await app.request('/disputes', { method: 'POST', headers: care(), body: disputeBody() })).status).toBe(400)
    const first = await app.request('/disputes', { method: 'POST', headers: care({ 'idempotency-key': 'd2' }), body: disputeBody() })
    const second = await app.request('/disputes', { method: 'POST', headers: care({ 'idempotency-key': 'd2' }), body: disputeBody() })
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(egress.disputeCalls).toBe(1)
  })

  it('rejects an invalid dispute_type (400)', async () => {
    const { app } = appWith()
    const res = await app.request('/disputes', {
      method: 'POST',
      headers: care({ 'idempotency-key': 'd3' }),
      body: JSON.stringify({ psu_identifier: psu.bank_customer_id, dispute_type: 'nonsense' })
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BACKOFFICE.INVALID_DISPUTE_TYPE')
  })

  it('rejects a persona without disputes:admin (403)', async () => {
    const { app, egress } = appWith()
    const res = await app.request('/disputes', {
      method: 'POST',
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst', 'content-type': 'application/json', 'idempotency-key': 'd4' },
      body: disputeBody()
    })
    expect(res.status).toBe(403)
    expect(egress.disputeCalls).toBe(0)
  })
})

describe('GET /disputes', () => {
  it('lists created disputes (filterable by psu_identifier), envelope + next_cursor in meta', async () => {
    const { app } = appWith()
    const created = await app.request('/disputes', { method: 'POST', headers: care({ 'idempotency-key': 'd5' }), body: disputeBody() })
    const id = ((await created.json()) as { data: { id: string } }).data.id

    const list = await app.request(`/disputes?psu_identifier=${psu.bank_customer_id}`, { headers: care() })
    expect(list.status).toBe(200)
    const listBody = (await list.json()) as { data: Array<{ id: string; psu_identifier: string }>; meta: { next_cursor: string | null } }
    expect(listBody.data.some((d) => d.id === id)).toBe(true)
    expect(listBody.data.every((d) => d.psu_identifier === psu.bank_customer_id)).toBe(true)
    expect(listBody.meta).toHaveProperty('next_cursor')
  })

  it('rejects a persona without disputes:admin (403)', async () => {
    const { app } = appWith()
    const res = await app.request('/disputes', { headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst' } })
    expect(res.status).toBe(403)
  })
})
