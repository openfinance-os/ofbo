import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgLineageEmitter, PgRespondentDisputeStore } from '@ofbo/db'
import { createApp } from '../src/app.js'

/**
 * BACKOFFICE-75 — respondent_dispute persistence + audit + lineage over real
 * Postgres. The store runs as ofbo_app with the tenancy context set, so RLS is
 * exercised end-to-end (register + advance), and each write emits one High-class
 * audit row and respondent_dispute lineage.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }

const fin = (extra: Record<string, string>) => ({
  authorization: 'Bearer demo-token:finance-analyst',
  'content-type': 'application/json',
  ...extra
})

describe('respondent dispute — persistence + audit + lineage', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)
  const respondentDisputeStore = new PgRespondentDisputeStore(url!, TENANCY, lineage)
  const app = createApp({ respondentDisputeStore, audit })

  beforeAll(async () => {
    await applyMigrations(url!)
  }, 60_000)
  afterAll(async () => {
    await audit.close()
    await lineage.close()
    await respondentDisputeStore.close()
    await admin.end()
  })

  it('registers (persists row + audit + lineage), then advances (updates clock + second audit)', async () => {
    const trace = randomUUID()
    const ref = `NBR-INT-${trace.slice(0, 8)}`
    const reg = await app.request('/back-office/disputes/respondent', {
      method: 'POST',
      headers: fin({ 'x-fapi-interaction-id': trace, 'idempotency-key': randomUUID() }),
      body: JSON.stringify({ nebras_dispute_ref: ref, category: 'billing', raised_at: '2026-06-01T09:00:00.000Z' })
    })
    expect(reg.status).toBe(201)
    const created = ((await reg.json()) as { data: { id: string; state: string } }).data
    expect(created.state).toBe('received')

    // row persisted with the computed clocks
    const row = await admin.query(
      `SELECT nebras_dispute_ref, category, state, response_due_at, resolution_due_at FROM respondent_dispute WHERE id = $1`,
      [created.id]
    )
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0]).toMatchObject({ nebras_dispute_ref: ref, category: 'billing', state: 'received' })
    expect(row.rows[0].response_due_at).not.toBeNull()
    expect(row.rows[0].resolution_due_at).not.toBeNull()

    // one High-class audit for the registration
    const remit = await admin.query(
      `SELECT target_dispute_id FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'respondent_dispute_registered'`,
      [trace]
    )
    expect(remit.rows).toHaveLength(1)
    expect(remit.rows[0].target_dispute_id).toBe(created.id)

    // lineage emitted for respondent_dispute
    const lin = await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'respondent_dispute'`, [trace])
    expect(lin.rows.length).toBeGreaterThan(0)

    // advance: respond stops the response clock
    const advTrace = randomUUID()
    const adv = await app.request(`/back-office/disputes/respondent/${created.id}:advance`, {
      method: 'POST',
      headers: fin({ 'x-fapi-interaction-id': advTrace, 'idempotency-key': randomUUID() }),
      body: JSON.stringify({ action: 'respond', note: 'Filed the bank response with the scheme today.' })
    })
    expect(adv.status).toBe(200)

    const after = await admin.query(`SELECT state, responded_at FROM respondent_dispute WHERE id = $1`, [created.id])
    expect(after.rows[0].state).toBe('responded')
    expect(after.rows[0].responded_at).not.toBeNull()

    const advAudit = await admin.query(
      `SELECT 1 FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'respondent_dispute_advanced'`,
      [advTrace]
    )
    expect(advAudit.rows).toHaveLength(1)
  }, 60_000)
})
