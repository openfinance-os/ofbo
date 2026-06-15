import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, seedDemoDataset, PgAuditReader, PgAuditEmitter, PgLineageEmitter } from '@ofbo/db'
import { AuditEventsService } from '../src/audit/events.js'
import type { Principal } from '../src/auth.js'

/**
 * BACKOFFICE-42 integration: the drill-down reads the real High-class audit trail
 * under RLS, and the drill-down access is itself logged (audit_trail_accessed) — and
 * that log is INSERT-only — against real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const compliance: Principal = { subject: 'demo:compliance', persona: 'compliance-officer', scopes: ['audit:read'] }

describe('Audit drill-down — query + get under RLS, access logged', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const reader = new PgAuditReader(url!, TENANCY)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(url!)
    await seedDemoDataset(url!) // seeds consent_granted/revoked/accessed audit rows
  })
  afterAll(async () => {
    await reader.close()
    await audit.close()
    await lineage.close()
    await admin.end()
  })

  it('queries the trail, returns the full record, and logs the drill-down access', async () => {
    const svc = new AuditEventsService({ reader, audit })
    const trace = randomUUID()

    const page = await svc.query(compliance, { event_type: 'consent_revoked', limit: 50 }, trace)
    expect(page.rows.length).toBeGreaterThan(0)
    const first = page.rows[0]!
    expect(first).toHaveProperty('request_body_redacted')
    expect(first.event_type).toBe('consent_revoked')

    // get a single record by id
    const one = await svc.get(compliance, first.id, randomUUID())
    expect(one.id).toBe(first.id)

    // the drill-down access is itself logged (INSERT-only High-class record)
    const access = await admin.query(`SELECT count(*)::int AS n FROM audit_high_sensitivity WHERE event_type = 'audit_trail_accessed' AND request_trace_id = $1`, [trace])
    expect(access.rows[0].n).toBe(1)
  })
})
