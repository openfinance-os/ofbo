import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgLineageEmitter } from '@ofbo/db'
import { CallRecordingService } from '../src/disputes/call-recording.js'
import { mintScopes, type Principal } from '../src/auth.js'
import type { DisputeStore } from '../src/disputes/service.js'

/**
 * BACKOFFICE-64 integration: accessing a dispute's call recording writes exactly one
 * High-class call_recording_accessed audit under RLS, naming the acting agent and the
 * target dispute. Real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const CARE: Principal = { subject: 'demo:customer-care-agent', persona: 'customer-care-agent', scopes: mintScopes('customer-care-agent') }

// target_dispute_id is a UUID column, so the dispute id must be a real UUID.
const DISPUTE_ID = randomUUID()
const store = {
  get: async (id: string) => (id === DISPUTE_ID ? { id, originating_call_id: 'call-xyz' } : null)
} as unknown as DisputeStore
const careSurface = {
  resolveCallRecording: async ({ call_id }: { call_id: string }) => ({
    recording_ref: `rec-${call_id}`,
    recording_url: `https://cc.demo/${call_id}`,
    expires_at: '2026-06-20T12:15:00.000Z'
  })
}

describe('dispute call-recording — access audited under RLS', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(url!)
  })
  afterAll(async () => {
    await audit.close()
    await lineage.close()
    await admin.end()
  })

  it('persists exactly one call_recording_accessed audit naming agent + dispute', async () => {
    const svc = new CallRecordingService({ store, careSurface, audit })
    const trace = randomUUID()
    const rec = await svc.getRecording(CARE, DISPUTE_ID, trace)
    expect(rec.recording_ref).toBe('rec-call-xyz')

    const row = await admin.query(
      `SELECT acting_persona, scope_used, target_dispute_id
         FROM audit_high_sensitivity
        WHERE request_trace_id = $1 AND event_type = 'call_recording_accessed'`,
      [trace]
    )
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0].acting_persona).toBe('customer-care-agent')
    expect(row.rows[0].scope_used).toBe('disputes:admin')
    expect(row.rows[0].target_dispute_id).toBe(DISPUTE_ID)
  })
})
