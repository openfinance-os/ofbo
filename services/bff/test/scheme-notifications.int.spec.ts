import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgLineageEmitter, PgSchemeNotificationStore } from '@ofbo/db'
import { createApp } from '../src/app.js'

/**
 * BACKOFFICE-78 — scheme_notification persistence + audit + lineage over real
 * Postgres. The store runs as ofbo_app with the tenancy context set, so RLS is
 * exercised end-to-end (raise + acknowledge); each write emits one High-class audit
 * row and scheme_notification lineage.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }

const ops = (extra: Record<string, string>) => ({
  authorization: 'Bearer demo-token:operations-analyst',
  'content-type': 'application/json',
  ...extra
})

describe('scheme notification — persistence + audit + lineage', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)
  const schemeNotificationStore = new PgSchemeNotificationStore(url!, TENANCY, lineage)
  const app = createApp({ schemeNotificationStore, audit })

  beforeAll(async () => {
    await applyMigrations(url!)
  }, 60_000)
  afterAll(async () => {
    await audit.close()
    await lineage.close()
    await schemeNotificationStore.close()
    await admin.end()
  })

  it('raises (persists row + audit + lineage, 30d breaking-change clock) then acknowledges', async () => {
    const trace = randomUUID()
    const reg = await app.request('/back-office/scheme-notifications', {
      method: 'POST',
      headers: ops({ 'x-fapi-interaction-id': trace, 'idempotency-key': randomUUID() }),
      body: JSON.stringify({
        notification_type: 'breaking_change',
        title: 'API v2.1 breaking change rollout',
        scheduled_start: '2030-02-01T00:00:00.000Z',
        scheduled_end: '2030-02-01T02:00:00.000Z'
      })
    })
    expect(reg.status).toBe(201)
    const created = ((await reg.json()) as { data: { id: string; notice_required_days: number; dual_running_required: boolean } }).data
    expect(created.notice_required_days).toBe(30)
    expect(created.dual_running_required).toBe(true)

    const row = await admin.query(
      `SELECT notification_type, status, notice_required_days, notice_compliant, dual_running_required FROM scheme_notification WHERE id = $1`,
      [created.id]
    )
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0]).toMatchObject({ notification_type: 'breaking_change', status: 'notified', notice_required_days: 30, dual_running_required: true })

    const remit = await admin.query(
      `SELECT 1 FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'scheme_notification_raised'`,
      [trace]
    )
    expect(remit.rows).toHaveLength(1)

    const lin = await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'scheme_notification'`, [trace])
    expect(lin.rows.length).toBeGreaterThan(0)

    const ackTrace = randomUUID()
    const ack = await app.request(`/back-office/scheme-notifications/${created.id}:acknowledge`, {
      method: 'POST',
      headers: ops({ 'x-fapi-interaction-id': ackTrace, 'idempotency-key': randomUUID() }),
      body: JSON.stringify({ nebras_ack_reference: 'NBR-ACK-INT-1' })
    })
    expect(ack.status).toBe(200)

    const after = await admin.query(`SELECT status, acknowledged, nebras_ack_reference FROM scheme_notification WHERE id = $1`, [created.id])
    expect(after.rows[0]).toMatchObject({ status: 'acknowledged', acknowledged: true, nebras_ack_reference: 'NBR-ACK-INT-1' })

    const ackAudit = await admin.query(
      `SELECT 1 FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'scheme_notification_acknowledged'`,
      [ackTrace]
    )
    expect(ackAudit.rows).toHaveLength(1)
  }, 60_000)
})
