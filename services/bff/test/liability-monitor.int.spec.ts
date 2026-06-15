import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgLineageEmitter, PgRiskSignalEmitter, PgRiskMetricsStore } from '@ofbo/db'
import { LiabilityMonitorService, LiabilityViewService } from '../src/risk/liability.js'
import type { Principal } from '../src/auth.js'

/**
 * BACKOFFICE-36 integration: the monitor emits a nebras_liability_approach risk_signal
 * (with the issue|party|AED ref) under RLS, and the read view surfaces it — real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const risk: Principal = { subject: 'demo:risk', persona: 'risk-analyst', scopes: ['risk:read'] }

class FakeItsm {
  count = 0
  async createTicket() {
    this.count += 1
    return { ticket_id: `tk-${this.count}` }
  }
}

describe('Liability monitor — emit + read under RLS', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const signals = new PgRiskSignalEmitter(url!, TENANCY, lineage)
  const metrics = new PgRiskMetricsStore(url!, TENANCY)

  beforeAll(async () => {
    await applyMigrations(url!)
  })
  afterAll(async () => {
    await signals.close()
    await metrics.close()
    await lineage.close()
    await admin.end()
  })

  it('evaluate persists a liability signal with the ref + lineage; dedup on re-run; view surfaces it', async () => {
    const itsm = new FakeItsm()
    const monitor = new LiabilityMonitorService({ signals, itsm })
    const trace = randomUUID()
    const events = [{ issue: 'deprecation_mismanagement' as const, liable_party: 'LFI' as const, incident_count: 1 }]

    const out = await monitor.evaluate(events, new Set(), trace)
    expect(out[0]!.emitted).toBe(true)
    expect(out[0]!.ref).toBe('deprecation_mismanagement|LFI|2500')
    expect(itsm.count).toBe(2) // Risk + Ops

    const row = await admin.query(`SELECT severity, nebras_liability_event_ref FROM risk_signal WHERE signal_type = 'nebras_liability_approach' AND nebras_liability_event_ref = $1`, ['deprecation_mismanagement|LFI|2500'])
    expect(row.rows.length).toBeGreaterThan(0)
    expect(row.rows[0].severity).toBe('high') // 2500 AED
    expect((await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'risk_signal'`, [trace])).rows.length).toBeGreaterThan(0)

    // dedup: re-run with the open ref → no new signal
    const open = await metrics.liabilityMonitor()
    const openRefs = new Set(open.recent.map((s) => s.nebras_liability_event_ref).filter((r): r is string => !!r))
    const out2 = await monitor.evaluate(events, openRefs, randomUUID())
    expect(out2[0]!.emitted).toBe(false)

    // the read view surfaces the approaching trigger
    const { data } = await new LiabilityViewService({ riskMetrics: metrics }).view(risk)
    const triggers = data.approaching_triggers as { issue: string }[]
    expect(triggers.some((t) => t.issue === 'deprecation_mismanagement')).toBe(true)
  })
})
