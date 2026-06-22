import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgLineageEmitter, PgRiskSignalEmitter, PgRiskMetricsStore, PgAuditEmitter, seedQueryPurposes } from '@ofbo/db'
import { RiskViewService } from '../src/analytics/risk-view.js'
import type { Principal } from '../src/auth.js'

/**
 * BACKOFFICE-30 / BACKOFFICE-33 integration: the Risk View aggregates real risk_signal rows via
 * the GOVERNED cross-fintech path (summary + liability monitor run as bank_internal_view, purpose
 * risk_monitoring, High-class logged); the recent-active list stays a tenant-scoped read.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const risk: Principal = { subject: 'demo:risk', persona: 'risk-analyst', scopes: ['risk:read'] }

describe('Risk View — aggregates over real risk_signal rows (RLS)', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const emitter = new PgRiskSignalEmitter(url!, TENANCY, lineage)
  const audit = new PgAuditEmitter(url!, TENANCY)
  const metrics = new PgRiskMetricsStore(url!, TENANCY, audit)

  const countBypassLogs = async (): Promise<number> =>
    (await admin.query(`SELECT count(*)::int AS n FROM audit_high_sensitivity WHERE event_type = 'cross_fintech_query'`)).rows[0].n as number

  beforeAll(async () => {
    await applyMigrations(url!)
    await seedQueryPurposes(admin, TENANCY.bankId, TENANCY.channel, { lineage }) // risk_monitoring → approved
    // anomaly signals via the production write path (open)
    await emitter.record({ signal_type: 'consent_anomaly', severity: 'high', acting_principal: 'system', summary: 'platform-Nebras drift on a consent mirror', trace_id: randomUUID() })
    await emitter.record({ signal_type: 'tpp_behaviour', severity: 'medium', acting_principal: 'system', summary: 'volume spike', trace_id: randomUUID() })
    // a proactive liability signal with a liability ref (issue x liable party x AED)
    await admin.query(
      `INSERT INTO risk_signal (bank_id, channel, signal_type, severity, status, signal_data, nebras_liability_event_ref)
       VALUES ($1, 'internal_retail', 'nebras_liability_approach', 'critical', 'open', '{}'::jsonb, $2)`,
      [TENANCY.bankId, 'consent_state_failure|LFI|500']
    )
  })
  afterAll(async () => {
    await emitter.close()
    await metrics.close()
    await lineage.close()
    await audit.close()
    await admin.end()
  })

  it('summarizes signals + surfaces the liability monitor via the governed path (logs each bypass)', async () => {
    const svc = new RiskViewService({ metrics })
    const before = await countBypassLogs()
    const { data, freshness } = await svc.view(risk, 'trace-test')

    const summary = data.signal_summary as { active_total: number; by_type: Record<string, number> }
    expect(summary.active_total).toBeGreaterThanOrEqual(3)
    expect(summary.by_type.consent_anomaly).toBeGreaterThanOrEqual(1)
    expect(summary.by_type.nebras_liability_approach).toBeGreaterThanOrEqual(1)

    const liability = data.liability_monitor as { open_count: number; recent: { nebras_liability_event_ref: string }[] }
    expect(liability.open_count).toBeGreaterThanOrEqual(1)
    expect(liability.recent.some((r) => r.nebras_liability_event_ref === 'consent_state_failure|LFI|500')).toBe(true)

    // recent_signals carry typed headers, never the raw signal_data blob
    const headers = data.recent_signals as Record<string, unknown>[]
    expect(headers.length).toBeGreaterThan(0)
    expect(headers[0]).not.toHaveProperty('signal_data')
    expect(freshness.stale).toBe(false)

    // summary + liability monitor are the two governed cross-fintech reads → two bypass logs
    // (recent-active is a tenant-scoped read, not logged).
    expect(await countBypassLogs()).toBe(before + 2)
  })
})
