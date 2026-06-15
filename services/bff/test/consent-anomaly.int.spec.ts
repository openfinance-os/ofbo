import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgLineageEmitter, PgRiskSignalEmitter, PgAnomalyDetectionStore } from '@ofbo/db'
import { ConsentAnomalyDetector } from '../src/risk/consent-anomaly.js'

/**
 * BACKOFFICE-37 integration: a windowed scan over real audit_high_sensitivity flags
 * a churning PSU + an over-looking agent, persists consent_anomaly / agent_anomaly
 * risk_signals (session flagged, deduped) under RLS — real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const PSU = `BCID-CHURN-${randomUUID().slice(0, 8)}`
const AGENT = `demo:agent-${randomUUID().slice(0, 8)}`

describe('Consent-anomaly detector — emit under RLS', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const signals = new PgRiskSignalEmitter(url!, TENANCY, lineage)
  const detection = new PgAnomalyDetectionStore(url!, TENANCY)

  beforeAll(async () => {
    await applyMigrations(url!)
    // 6 revoke + 6 grant for one PSU (cycles 6 > 5) within 24h
    for (let i = 0; i < 6; i++) {
      for (const evt of ['consent_revoked', 'consent_granted']) {
        await admin.query(
          `INSERT INTO audit_high_sensitivity (bank_id, channel, event_type, acting_principal, acting_persona, scope_used, target_psu_identifier, request_trace_id, response_status)
           VALUES ($1, 'internal_retail', $2, 'demo:care', 'customer-care-agent', 'consents:admin', $3, $4, 200)`,
          [TENANCY.bankId, evt, PSU, randomUUID()]
        )
      }
    }
    // 101 PSU lookups for one agent within 1h
    await admin.query(
      `INSERT INTO audit_high_sensitivity (bank_id, channel, event_type, acting_principal, acting_persona, scope_used, target_psu_identifier, request_trace_id, response_status)
       SELECT $1, 'internal_retail', 'consent_search', $2, 'customer-care-agent', 'consents:admin', 'BCID-X', gen_random_uuid()::text, 200
         FROM generate_series(1, 101)`,
      [TENANCY.bankId, AGENT]
    )
  })
  afterAll(async () => {
    await signals.close()
    await detection.close()
    await lineage.close()
    await admin.end()
  })

  it('detects churn + over-lookup, emits signals with session flag + dedup; re-run dedups', async () => {
    const det = new ConsentAnomalyDetector({ detection, signals })
    const out = await det.detect(randomUUID())
    expect(out.some((a) => a.rule === 'consent_churn' && a.emitted)).toBe(true)
    expect(out.some((a) => a.rule === 'agent_lookups' && a.emitted)).toBe(true)

    const consent = await admin.query(`SELECT signal_data FROM risk_signal WHERE signal_type = 'consent_anomaly' AND signal_data->>'dedup_key' LIKE 'consent_churn|%' ORDER BY created_at DESC LIMIT 1`)
    expect(consent.rows.length).toBeGreaterThan(0)
    expect(consent.rows[0].signal_data.session_flagged).toBe(true)
    // no raw PSU identifier in the persisted signal
    expect(JSON.stringify(consent.rows[0].signal_data)).not.toContain(PSU)

    const agent = await admin.query(`SELECT signal_data FROM risk_signal WHERE signal_type = 'agent_anomaly' AND signal_data->>'dedup_key' = $1`, [`agent_lookups|${AGENT}`])
    expect(agent.rows.length).toBe(1)
    expect(agent.rows[0].signal_data.lookup_count).toBe(101)

    // re-run: open dedup keys suppress re-emission
    const before = (await admin.query(`SELECT count(*)::int AS n FROM risk_signal WHERE signal_type IN ('consent_anomaly','agent_anomaly')`)).rows[0].n
    await det.detect(randomUUID())
    const after = (await admin.query(`SELECT count(*)::int AS n FROM risk_signal WHERE signal_type IN ('consent_anomaly','agent_anomaly')`)).rows[0].n
    expect(after).toBe(before)
  })
})
