import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgFraudIncidentStore, PgLineageEmitter } from '@ofbo/db'
import { createApp } from '../src/app.js'

/**
 * BACKOFFICE-77 — fraud_incident persistence + audit + lineage over real Postgres.
 * The store runs as ofbo_app with the tenancy context set, so RLS is exercised
 * end-to-end (report + resolve); each write emits one High-class audit row and
 * fraud_incident lineage.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }

const risk = (extra: Record<string, string>) => ({
  authorization: 'Bearer demo-token:risk-analyst',
  'content-type': 'application/json',
  ...extra
})

describe('fraud incident — persistence + audit + lineage', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)
  const fraudIncidentStore = new PgFraudIncidentStore(url!, TENANCY, lineage)
  const app = createApp({ fraudIncidentStore, audit })

  beforeAll(async () => {
    await applyMigrations(url!)
  }, 60_000)
  afterAll(async () => {
    await audit.close()
    await lineage.close()
    await fraudIncidentStore.close()
    await admin.end()
  })

  it('reports (persists row + audit + lineage, P1 hold) then resolves (lifts pause + second audit)', async () => {
    const trace = randomUUID()
    const reg = await app.request('/back-office/fraud-incidents', {
      method: 'POST',
      headers: risk({ 'x-fapi-interaction-id': trace, 'idempotency-key': randomUUID() }),
      body: JSON.stringify({ nebras_severity: 'P1', summary: 'Systemic fraud signal across multiple TPP consents.' })
    })
    expect(reg.status).toBe(201)
    const created = ((await reg.json()) as { data: { id: string; itsm_priority: string; scheme_imposed_hold: boolean } }).data
    expect(created.itsm_priority).toBe('critical')
    expect(created.scheme_imposed_hold).toBe(true)

    const row = await admin.query(
      `SELECT nebras_severity, itsm_priority, status, operational_pause, scheme_imposed_hold FROM fraud_incident WHERE id = $1`,
      [created.id]
    )
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0]).toMatchObject({ nebras_severity: 'P1', itsm_priority: 'critical', status: 'reported', operational_pause: true, scheme_imposed_hold: true })

    const remit = await admin.query(
      `SELECT 1 FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'fraud_incident_reported'`,
      [trace]
    )
    expect(remit.rows).toHaveLength(1)

    const lin = await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'fraud_incident'`, [trace])
    expect(lin.rows.length).toBeGreaterThan(0)

    const resolveTrace = randomUUID()
    const res = await app.request(`/back-office/fraud-incidents/${created.id}:resolve`, {
      method: 'POST',
      headers: risk({ 'x-fapi-interaction-id': resolveTrace, 'idempotency-key': randomUUID() }),
      body: JSON.stringify({ resolution_note: 'Investigation closed; no systemic exposure confirmed.' })
    })
    expect(res.status).toBe(200)

    const after = await admin.query(`SELECT status, operational_pause, resolved_at FROM fraud_incident WHERE id = $1`, [created.id])
    expect(after.rows[0]).toMatchObject({ status: 'resolved', operational_pause: false })
    expect(after.rows[0].resolved_at).not.toBeNull()

    const resAudit = await admin.query(
      `SELECT 1 FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'fraud_incident_resolved'`,
      [resolveTrace]
    )
    expect(resAudit.rows).toHaveLength(1)
  }, 60_000)
})
