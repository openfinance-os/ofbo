import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgDisputeStore, PgLineageEmitter } from '@ofbo/db'
import { DisputeService } from '../src/disputes/service.js'
import { mintScopes, type Principal } from '../src/auth.js'

/**
 * BACKOFFICE-24 integration: a dispute state transition persists under RLS
 * (state + escalated_to + resolution_note + state_changed_at), emits BCBS 239
 * lineage, and writes a dispute_state_changed High-class audit. Real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const CARE: Principal = { subject: 'demo:customer-care-agent', persona: 'customer-care-agent', scopes: mintScopes('customer-care-agent') }

class FakeEgress {
  async createDisputeCase() {
    return { nebras_case_id: 'nebras-int-lifecycle' }
  }
}

describe('dispute lifecycle — state transition persists under RLS with lineage + audit', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const store = new PgDisputeStore(url!, TENANCY, lineage)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(url!)
  })
  afterAll(async () => {
    await store.close()
    await audit.close()
    await lineage.close()
    await admin.end()
  })

  it('transitions a complaint open → escalated, persisting metadata + audit', async () => {
    const svc = new DisputeService({
      store,
      payments: { get: () => null, byPsu: () => [] },
      egress: new FakeEgress(),
      audit,
      approvals: { requestApproval: async () => ({}) as never }
    })

    const created = await svc.create(CARE, { psu_identifier: 'BCID-INT-CMP', dispute_type: 'consent_complaint' }, randomUUID())
    expect(created.state).toBe('open')

    const trace = randomUUID()
    const escalated = await svc.updateState(CARE, created.id, { state: 'escalated', escalated_to: 'tier2-complaints', resolution_note: 'awaiting PSU callback' }, trace)
    expect(escalated.state).toBe('escalated')

    // persisted under tenancy incl. the write-only lifecycle columns
    const row = await admin.query(`SELECT state, escalated_to, resolution_note, state_changed_at FROM dispute_case WHERE id = $1`, [created.id])
    expect(row.rows[0].state).toBe('escalated')
    expect(row.rows[0].escalated_to).toBe('tier2-complaints')
    expect(row.rows[0].resolution_note).toBe('awaiting PSU callback')
    expect(row.rows[0].state_changed_at).toBeTruthy()

    // BCBS 239 lineage for the dispute write
    expect((await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'dispute_case'`, [trace])).rows.length).toBeGreaterThan(0)

    // High-class audit captured the transition
    const ev = await admin.query(`SELECT acting_persona FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'dispute_state_changed'`, [trace])
    expect(ev.rows).toHaveLength(1)
    expect(ev.rows[0].acting_persona).toBe('customer-care-agent')

    // illegal transition rejected (closed → open)
    await svc.updateState(CARE, created.id, { state: 'closed' }, randomUUID())
    await expect(svc.updateState(CARE, created.id, { state: 'open' }, randomUUID())).rejects.toThrow()
  })
})
