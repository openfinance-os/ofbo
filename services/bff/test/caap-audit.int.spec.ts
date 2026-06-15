import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgLineageEmitter, PgRiskSignalEmitter, PgAnomalyDetectionStore } from '@ofbo/db'
import { CaapRegistrationRecorder, type CaapEvent } from '../src/risk/caap-audit.js'
import { ConsentAnomalyDetector } from '../src/risk/consent-anomaly.js'

/**
 * BACKOFFICE-69 integration: CAAP register events are recorded as High-class audits
 * under RLS, and the streaming watch flags a device with >10 registrations/hour as an
 * agent_anomaly (deduped across runs). Real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const DEVICE = `device:caap-${randomUUID().slice(0, 8)}`

describe('CAAP registration audit + anomaly watch under RLS', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)
  const signals = new PgRiskSignalEmitter(url!, TENANCY, lineage)
  const detection = new PgAnomalyDetectionStore(url!, TENANCY)

  beforeAll(async () => {
    await applyMigrations(url!)
  })
  afterAll(async () => {
    await audit.close()
    await signals.close()
    await detection.close()
    await lineage.close()
    await admin.end()
  })

  it('records caap_registered audits and flags the >10/device/hour spike as agent_anomaly', async () => {
    const events: CaapEvent[] = Array.from({ length: 12 }, (_, i) => ({ device_ref: DEVICE, caap_user_ref: `caap-user-${i}`, action: 'register' as const }))
    const recTrace = randomUUID()
    await new CaapRegistrationRecorder({ audit }).record(events, recTrace)

    // High-class audits persisted (one per event) with the device as acting principal
    const audits = await admin.query(`SELECT count(*)::int AS n FROM audit_high_sensitivity WHERE event_type = 'caap_registered' AND acting_principal = $1`, [DEVICE])
    expect(audits.rows[0].n).toBe(12)

    // the streaming watch flags the device as an agent_anomaly (caap_registration rule)
    const det = new ConsentAnomalyDetector({ detection, signals })
    const out = await det.detect(randomUUID())
    const caap = out.find((a) => a.rule === 'caap_registration' && a.subject_ref === DEVICE)
    expect(caap?.emitted).toBe(true)

    const sig = await admin.query(`SELECT 1 FROM risk_signal WHERE signal_type = 'agent_anomaly' AND signal_data->>'dedup_key' = $1`, [`caap_registration|${DEVICE}`])
    expect(sig.rows).toHaveLength(1)

    // second run dedups — no second signal
    const out2 = await det.detect(randomUUID())
    expect(out2.find((a) => a.rule === 'caap_registration' && a.subject_ref === DEVICE)?.emitted).toBe(false)
    const sig2 = await admin.query(`SELECT count(*)::int AS n FROM risk_signal WHERE signal_type = 'agent_anomaly' AND signal_data->>'dedup_key' = $1`, [`caap_registration|${DEVICE}`])
    expect(sig2.rows[0].n).toBe(1)
  })
})
