import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgLineageEmitter, PgTrustFrameworkParticipantStore } from '@ofbo/db'
import { createApp } from '../src/app.js'

/**
 * BACKOFFICE-74 — trust_framework_participant persistence + audit + lineage over real
 * Postgres (RLS via ofbo_app), through register + turnover (nominate-replacement).
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }

const ops = (extra: Record<string, string>) => ({
  authorization: 'Bearer demo-token:operations-analyst',
  'content-type': 'application/json',
  ...extra
})

describe('Trust Framework participant — persistence + audit + lineage', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)
  const trustFrameworkStore = new PgTrustFrameworkParticipantStore(url!, TENANCY, lineage)
  const app = createApp({ trustFrameworkStore, audit })

  beforeAll(async () => {
    await applyMigrations(url!)
  }, 60_000)
  afterAll(async () => {
    await audit.close()
    await lineage.close()
    await trustFrameworkStore.close()
    await admin.end()
  })

  it('registers (row + audit + lineage) then nominates a replacement (departing + audit)', async () => {
    const trace = randomUUID()
    const reg = await app.request('/back-office/trust-framework/participants', {
      method: 'POST',
      headers: ops({ 'x-fapi-interaction-id': trace, 'idempotency-key': randomUUID() }),
      body: JSON.stringify({ role: 'ptc', organisation_id: `ORG-${trace.slice(0, 8)}`, holder_ref: 'emp-int-1', holder_display_name: 'Int Operator', onboarding_stage: 'pre_prod_cx' })
    })
    expect(reg.status).toBe(201)
    const created = ((await reg.json()) as { data: { id: string; status: string } }).data
    expect(created.status).toBe('active')

    const row = await admin.query(`SELECT role, status, individual_tnc_status FROM trust_framework_participant WHERE id = $1`, [created.id])
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0]).toMatchObject({ role: 'ptc', status: 'active', individual_tnc_status: 'not_started' })

    const remit = await admin.query(`SELECT 1 FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'trust_framework_participant_registered'`, [trace])
    expect(remit.rows).toHaveLength(1)
    const lin = await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'trust_framework_participant'`, [trace])
    expect(lin.rows.length).toBeGreaterThan(0)

    const nomTrace = randomUUID()
    const nom = await app.request(`/back-office/trust-framework/participants/${created.id}:nominate-replacement`, {
      method: 'POST',
      headers: ops({ 'x-fapi-interaction-id': nomTrace, 'idempotency-key': randomUUID() }),
      body: JSON.stringify({ replacement_holder_ref: 'emp-int-2', replacement_display_name: 'Int Successor', note: 'Role-holder departing; successor nominated for handover.' })
    })
    expect(nom.status).toBe(200)
    const after = await admin.query(`SELECT status, nominated_replacement_ref FROM trust_framework_participant WHERE id = $1`, [created.id])
    expect(after.rows[0]).toMatchObject({ status: 'departing', nominated_replacement_ref: 'emp-int-2' })

    const nomAudit = await admin.query(`SELECT 1 FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'trust_framework_replacement_nominated'`, [nomTrace])
    expect(nomAudit.rows).toHaveLength(1)
  }, 60_000)
})
