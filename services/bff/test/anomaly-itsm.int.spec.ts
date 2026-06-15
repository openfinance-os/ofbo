import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgLineageEmitter, PgRiskSignalEmitter, PgAnomalyDetectionStore } from '@ofbo/db'
import { ConsentAnomalyDetector } from '../src/risk/consent-anomaly.js'

/**
 * BACKOFFICE-46 integration: repeated 403s + off-hours admin activity (real audit rows)
 * → agent_anomaly signals under RLS + P3 ITSM tickets (team-routed) — real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const AGENT_403 = `demo:agent-403-${randomUUID().slice(0, 8)}`
const AGENT_OFF = `demo:agent-off-${randomUUID().slice(0, 8)}`

class FakeItsm {
  tickets: { team: string; type: string }[] = []
  async createTicket(input: { type: string; team: string }) {
    this.tickets.push({ team: input.team, type: input.type })
    return { ticket_id: `tk-${this.tickets.length}` }
  }
}

describe('Anomaly ITSM escalation — new rules under RLS', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const signals = new PgRiskSignalEmitter(url!, TENANCY, lineage)
  const detection = new PgAnomalyDetectionStore(url!, TENANCY)

  beforeAll(async () => {
    await applyMigrations(url!)
    // 12 authorization denials for one agent within 1h
    await admin.query(
      `INSERT INTO audit_high_sensitivity (bank_id, channel, event_type, acting_principal, acting_persona, scope_used, request_trace_id, response_status)
       SELECT $1, 'internal_retail', 'scope_denied', $2, 'customer-care-agent', 'consents:admin', gen_random_uuid()::text, 403 FROM generate_series(1, 12)`,
      [TENANCY.bankId, AGENT_403]
    )
    // 18 off-hours (03:00 UTC) admin actions for another agent within 24h
    await admin.query(
      `INSERT INTO audit_high_sensitivity (bank_id, channel, event_type, acting_principal, acting_persona, scope_used, request_trace_id, response_status, created_at)
       SELECT $1, 'internal_retail', 'consent_revoked', $2, 'customer-care-agent', 'consents:admin', gen_random_uuid()::text, 200, (now()::date - 0) + time '03:00' FROM generate_series(1, 18)`,
      [TENANCY.bankId, AGENT_OFF]
    )
  })
  afterAll(async () => {
    await signals.close()
    await detection.close()
    await lineage.close()
    await admin.end()
  })

  it('detects repeated 403s + off-hours admin, emits agent_anomaly + Security ITSM tickets', async () => {
    const itsm = new FakeItsm()
    const det = new ConsentAnomalyDetector({ detection, signals, itsm })
    const out = await det.detect(randomUUID())

    const r403 = out.find((a) => a.rule === 'repeated_403s' && a.subject_ref === AGENT_403)
    const rOff = out.find((a) => a.rule === 'off_hours_admin' && a.subject_ref === AGENT_OFF)
    expect(r403?.emitted).toBe(true)
    expect(rOff?.emitted).toBe(true)

    expect((await admin.query(`SELECT 1 FROM risk_signal WHERE signal_type = 'agent_anomaly' AND signal_data->>'dedup_key' = $1`, [`repeated_403s|${AGENT_403}`])).rows.length).toBe(1)
    expect((await admin.query(`SELECT 1 FROM risk_signal WHERE signal_type = 'agent_anomaly' AND signal_data->>'dedup_key' = $1`, [`off_hours_admin|${AGENT_OFF}`])).rows.length).toBe(1)
    // both rules route to the Security team
    expect(itsm.tickets.filter((t) => t.type === 'audit_anomaly' && t.team === 'security').length).toBeGreaterThanOrEqual(2)
  })
})
