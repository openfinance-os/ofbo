import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgLineageEmitter, PgServiceDeskCaseStore } from '@ofbo/db'
import { createApp } from '../src/app.js'

/**
 * BACKOFFICE-79 — service_desk_case persistence + audit + lineage over real Postgres
 * (RLS via ofbo_app), through track + update.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }

const ops = (extra: Record<string, string>) => ({
  authorization: 'Bearer demo-token:operations-analyst',
  'content-type': 'application/json',
  ...extra
})

describe('service-desk case — persistence + audit + lineage', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)
  const serviceDeskStore = new PgServiceDeskCaseStore(url!, TENANCY, lineage)
  const app = createApp({ serviceDeskStore, audit })

  beforeAll(async () => {
    await applyMigrations(url!)
  }, 60_000)
  afterAll(async () => {
    await audit.close()
    await lineage.close()
    await serviceDeskStore.close()
    await admin.end()
  })

  it('tracks (row + audit + lineage) then updates to resolved (resolved_at + audit)', async () => {
    const trace = randomUUID()
    const reg = await app.request('/back-office/service-desk-cases', {
      method: 'POST',
      headers: ops({ 'x-fapi-interaction-id': trace, 'idempotency-key': randomUUID() }),
      body: JSON.stringify({ nebras_case_reference: `NBR-SD-${trace.slice(0, 8)}`, case_type: 'incident', priority: 'P1', summary: 'Ozone Connect outage reported to Nebras.' })
    })
    expect(reg.status).toBe(201)
    const created = ((await reg.json()) as { data: { id: string; status: string } }).data
    expect(created.status).toBe('open')

    const row = await admin.query(`SELECT case_type, priority, status FROM service_desk_case WHERE id = $1`, [created.id])
    expect(row.rows[0]).toMatchObject({ case_type: 'incident', priority: 'P1', status: 'open' })

    const remit = await admin.query(`SELECT 1 FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'service_desk_case_tracked'`, [trace])
    expect(remit.rows).toHaveLength(1)
    const lin = await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'service_desk_case'`, [trace])
    expect(lin.rows.length).toBeGreaterThan(0)

    const upTrace = randomUUID()
    const up = await app.request(`/back-office/service-desk-cases/${created.id}:update`, {
      method: 'POST',
      headers: ops({ 'x-fapi-interaction-id': upTrace, 'idempotency-key': randomUUID() }),
      body: JSON.stringify({ status: 'resolved', note: 'Nebras confirmed service restored; closing.' })
    })
    expect(up.status).toBe(200)
    const after = await admin.query(`SELECT status, resolved_at FROM service_desk_case WHERE id = $1`, [created.id])
    expect(after.rows[0].status).toBe('resolved')
    expect(after.rows[0].resolved_at).not.toBeNull()

    const upAudit = await admin.query(`SELECT 1 FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'service_desk_case_updated'`, [upTrace])
    expect(upAudit.rows).toHaveLength(1)
  }, 60_000)
})
