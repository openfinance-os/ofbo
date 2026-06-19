import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgLineageEmitter, PgLineageReader, PgRiskMetricsStore, PgRiskSignalEmitter } from '@ofbo/db'
import { createApp } from '../src/app.js'

/**
 * BACKOFFICE-30/-42/-49 — risk-signal list + triage and lineage read over real Postgres
 * (RLS via ofbo_app). A persisted risk_signal is listed + transitioned; its write-time
 * lineage is read back via GET /lineage/risk_signal.
 */
const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')
const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }

const risk = (extra: Record<string, string>) => ({ authorization: 'Bearer demo-token:risk-analyst', 'content-type': 'application/json', ...extra })
const compliance = (extra: Record<string, string>) => ({ authorization: 'Bearer demo-token:compliance-officer', ...extra })

describe('risk-signals list/triage + lineage read — persistence under RLS', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)
  const signals = new PgRiskSignalEmitter(url!, TENANCY, lineage)
  const riskMetrics = new PgRiskMetricsStore(url!, TENANCY)
  const lineageReader = new PgLineageReader(url!, TENANCY)
  const app = createApp({ audit, riskSignalStore: riskMetrics, lineageReader })

  beforeAll(async () => {
    await applyMigrations(url!)
  }, 60_000)
  afterAll(async () => {
    await audit.close()
    await lineage.close()
    await signals.close()
    await riskMetrics.close()
    await lineageReader.close()
    await admin.end()
  })

  it('lists a persisted signal, transitions its status (persisted + audited), and reads its lineage', async () => {
    const trace = randomUUID()
    const ref = `consent_anomaly|review-int-${trace.slice(0, 8)}`
    await signals.record({ signal_type: 'consent_anomaly', severity: 'high', acting_principal: 'system:test', summary: 'review int seed', trace_id: trace, nebras_liability_event_ref: ref })

    // find the seeded signal's id
    const seeded = await admin.query(`SELECT id FROM risk_signal WHERE nebras_liability_event_ref = $1`, [ref])
    expect(seeded.rows).toHaveLength(1)
    const id = seeded.rows[0].id as string

    // GET list (risk:read) includes it
    const list = await app.request('/back-office/risk-signals?signal_type=consent_anomaly', { headers: risk({ 'x-fapi-interaction-id': randomUUID() }) })
    expect(list.status).toBe(200)
    const rows = ((await list.json()) as { data: { id: string; status: string }[] }).data
    expect(rows.some((r) => r.id === id)).toBe(true)

    // PATCH triage (risk:investigations:write) → persisted
    const patchTrace = randomUUID()
    const patch = await app.request(`/back-office/risk-signals/${id}`, {
      method: 'PATCH',
      headers: risk({ 'x-fapi-interaction-id': patchTrace, 'idempotency-key': randomUUID() }),
      body: JSON.stringify({ status: 'investigating' })
    })
    expect(patch.status).toBe(200)
    const after = await admin.query(`SELECT status FROM risk_signal WHERE id = $1`, [id])
    expect(after.rows[0].status).toBe('investigating')
    const ev = await admin.query(`SELECT 1 FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'risk_signal_status_changed'`, [patchTrace])
    expect(ev.rows).toHaveLength(1)

    // GET lineage for risk_signal (compliance:reports:read) — the emitter wrote lineage
    const lin = await app.request('/back-office/lineage/risk_signal', { headers: compliance({ 'x-fapi-interaction-id': randomUUID() }) })
    expect(lin.status).toBe(200)
    const tree = ((await lin.json()) as { data: { table_name: string; columns: string[]; event_count: number } }).data
    expect(tree.table_name).toBe('risk_signal')
    expect(tree.event_count).toBeGreaterThan(0)
    expect(tree.columns).toContain('signal_type')
  }, 60_000)
})
