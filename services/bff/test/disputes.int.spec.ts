import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgDisputeStore, PgLineageEmitter } from '@ofbo/db'
import { generateDemoDataset } from '@ofbo/synthetic-data'
import { createApp } from '../src/app.js'

/**
 * BACKOFFICE-20 integration: creating a dispute persists a dispute_case row
 * (RLS-bound), writes a dispute_created High-class audit event, and emits
 * BCBS 239 lineage for dispute_case — all against real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const payment = generateDemoDataset().psus[0]!.payments[0]!
const PSU = `cust-int-${randomUUID()}`

describe('dispute creation — persistence + audit + lineage', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)
  const disputeStore = new PgDisputeStore(url!, TENANCY, lineage)
  const app = createApp({ disputeStore, audit }) // egress defaults to the P6 sim adapter

  beforeAll(async () => {
    await applyMigrations(url!)
  })
  afterAll(async () => {
    await audit.close()
    await lineage.close()
    await disputeStore.close()
    await admin.end()
  })

  it('persists the dispute, the audit event, and dispute_case lineage', async () => {
    const trace = randomUUID()
    const res = await app.request('/disputes', {
      method: 'POST',
      headers: {
        'x-fapi-interaction-id': trace,
        authorization: 'Bearer demo-token:customer-care-agent',
        'content-type': 'application/json',
        'idempotency-key': randomUUID()
      },
      body: JSON.stringify({
        psu_identifier: PSU,
        dispute_type: 'unauthorised_payment',
        originating_payment_id: payment.payment_id
      })
    })
    expect(res.status).toBe(201)
    const created = ((await res.json()) as { data: { id: string; nebras_case_id: string | null } }).data
    expect(created.nebras_case_id).toBeTruthy()

    const dc = await admin.query(`SELECT psu_identifier, dispute_type, state, nebras_case_id FROM dispute_case WHERE id = $1`, [created.id])
    expect(dc.rows).toHaveLength(1)
    expect(dc.rows[0]).toMatchObject({ psu_identifier: PSU, dispute_type: 'unauthorised_payment', state: 'open' })

    const ev = await admin.query(
      `SELECT target_dispute_id FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'dispute_created'`,
      [trace]
    )
    expect(ev.rows).toHaveLength(1)
    expect(ev.rows[0].target_dispute_id).toBe(created.id)

    const lin = await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'dispute_case'`, [trace])
    expect(lin.rows.length).toBeGreaterThan(0)

    // round-trips through the store (RLS-bound read) and the list API
    const readBack = await disputeStore.get(created.id)
    expect(readBack?.psu_identifier).toBe(PSU)
    const list = await app.request(`/disputes?psu_identifier=${PSU}`, {
      headers: { 'x-fapi-interaction-id': randomUUID(), authorization: 'Bearer demo-token:customer-care-agent' }
    })
    expect(list.status).toBe(200)
    expect(((await list.json()) as { data: Array<{ id: string }> }).data.some((d) => d.id === created.id)).toBe(true)
  })
})
