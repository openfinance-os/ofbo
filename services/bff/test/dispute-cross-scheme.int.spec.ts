import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgDisputeStore, PgLineageEmitter } from '@ofbo/db'
import { generateDemoDataset } from '@ofbo/synthetic-data'
import { createApp } from '../src/app.js'

/**
 * BACKOFFICE-76 — cross-scheme context persists on dispute_case (migration 0024) over
 * real Postgres (RLS via ofbo_app); the double-compensation guard reads it back.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const psu = generateDemoDataset().psus.find((p) => p.payments.length > 0)!
const payment = psu.payments[0]!

class FakeEgress {
  async createDisputeCase() {
    return { nebras_case_id: 'nebras-cs-int' }
  }
  async dispatchRefund() {
    return { ipp_status: 'ACSP' as const }
  }
  async revokeConsent() {
    return { acknowledged_in_ms: 10 }
  }
}

const care = (extra: Record<string, string>) => ({ authorization: 'Bearer demo-token:customer-care-agent', 'content-type': 'application/json', ...extra })

describe('dispute cross-scheme — persistence + guard', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)
  const disputeStore = new PgDisputeStore(url!, TENANCY, lineage)
  const app = createApp({ disputeStore, audit, nebrasEgress: new FakeEgress() })

  beforeAll(async () => {
    await applyMigrations(url!)
  }, 60_000)
  afterAll(async () => {
    await audit.close()
    await lineage.close()
    await disputeStore.close()
    await admin.end()
  })

  it('records cross-scheme context (persisted) and blocks a refund (409) once settled elsewhere', async () => {
    const trace = randomUUID()
    const reg = await app.request('/disputes', {
      method: 'POST',
      headers: care({ 'x-fapi-interaction-id': trace, 'idempotency-key': randomUUID() }),
      body: JSON.stringify({ psu_identifier: psu.bank_customer_id, dispute_type: 'unauthorised_payment', originating_payment_id: payment.payment_id })
    })
    expect(reg.status).toBe(201)
    const id = ((await reg.json()) as { data: { id: string } }).data.id

    const csTrace = randomUUID()
    const rec = await app.request(`/back-office/disputes/${id}:record-cross-scheme`, {
      method: 'POST',
      headers: care({ 'x-fapi-interaction-id': csTrace, 'idempotency-key': randomUUID() }),
      body: JSON.stringify({ aani_case_id: 'AANI-INT-1', settled_in_other_scheme: true, sanadak_reference: 'SAN-INT-1' })
    })
    expect(rec.status).toBe(200)

    const row = await admin.query(`SELECT aani_case_id, settled_in_other_scheme, compensation_blocked, sanadak_reference FROM dispute_case WHERE id = $1`, [id])
    expect(row.rows[0]).toMatchObject({ aani_case_id: 'AANI-INT-1', settled_in_other_scheme: true, compensation_blocked: true, sanadak_reference: 'SAN-INT-1' })

    const ev = await admin.query(`SELECT 1 FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'dispute_cross_scheme_recorded'`, [csTrace])
    expect(ev.rows).toHaveLength(1)

    // guard: refund now blocked (409)
    const refund = await app.request(`/disputes/${id}:initiate-refund`, {
      method: 'POST',
      headers: care({ 'x-fapi-interaction-id': randomUUID(), 'idempotency-key': randomUUID() }),
      body: JSON.stringify({ refund_amount: { amount: 5000, currency: 'AED' } })
    })
    expect(refund.status).toBe(409)
  }, 60_000)
})
