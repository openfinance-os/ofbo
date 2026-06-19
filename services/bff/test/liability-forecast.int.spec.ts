import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgLineageEmitter, PgRiskSignalEmitter } from '@ofbo/db'
import { LiabilityForecastMonitor, MIN_TELEMETRY_DAYS, type LiabilityTelemetryPoint } from '../src/risk/liability-forecast.js'

/**
 * BACKOFFICE-65 integration: the forecast monitor persists a predictive_liability_forecast
 * risk_signal (with the class ref) under RLS, with BCBS 239 lineage — real Postgres.
 * predictive_liability_forecast is already admitted by the risk_signal CHECK (no migration).
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const NOW = new Date('2026-06-19T00:00:00.000Z')

// a class with a sustained recent burst → high 24h crossing probability
const hot: LiabilityTelemetryPoint[] = Array.from({ length: MIN_TELEMETRY_DAYS }, (_, i) => ({
  date: new Date(NOW.getTime() - (MIN_TELEMETRY_DAYS - i) * 86400000).toISOString().slice(0, 10),
  issue: 'fraud_prevention_failure',
  liable_party: 'TPP' as const,
  incident_count: i >= MIN_TELEMETRY_DAYS - 10 ? 4 : 1
}))

class FakeItsm {
  count = 0
  async createTicket() {
    this.count += 1
    return { ticket_id: `tk-${this.count}` }
  }
}

describe('Liability forecast monitor — emit + lineage under RLS', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const signals = new PgRiskSignalEmitter(url!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(url!)
  }, 60_000)
  afterAll(async () => {
    await signals.close()
    await lineage.close()
    await admin.end()
  })

  it('persists a predictive_liability_forecast signal with the class ref + lineage', async () => {
    const itsm = new FakeItsm()
    const monitor = new LiabilityForecastMonitor({ telemetry: { getDailyTelemetry: async () => hot }, signals, itsm, now: () => NOW })
    const trace = randomUUID()
    const ref = 'fraud_prevention_failure|TPP|forecast'

    const result = await monitor.run(trace, new Set())
    expect(result.fallback_active).toBe(false)
    expect(result.emitted.some((f) => f.ref === ref)).toBe(true)

    const row = await admin.query(
      `SELECT severity, nebras_liability_event_ref FROM risk_signal WHERE signal_type = 'predictive_liability_forecast' AND nebras_liability_event_ref = $1`,
      [ref]
    )
    expect(row.rows.length).toBeGreaterThan(0)
    expect((await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'risk_signal'`, [trace])).rows.length).toBeGreaterThan(0)
  }, 60_000)
})
