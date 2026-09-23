import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { applyMigrations } from '../src/apply.js'
import { PgAuditEmitter } from '../src/audit.js'
import { PgRiskMetricsStore, PgRiskSignalEmitter } from '../src/risk-signal.js'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required for integration tests')

const BANK = '11111111-1111-4111-8111-111111111111'
const TRACE = `sa-int-${crypto.randomUUID()}` // unique per run: audit is INSERT-only by design

describe('BACKOFFICE-80 — marker column, review view, risk-signal emitter', () => {
  const admin = new pg.Pool({ connectionString: url })
  let audit: PgAuditEmitter
  let risk: PgRiskSignalEmitter

  beforeAll(async () => {
    await applyMigrations(url)
    audit = new PgAuditEmitter(url, { bankId: BANK, channel: 'internal_retail' })
    risk = new PgRiskSignalEmitter(url, { bankId: BANK, channel: 'internal_retail' })
  })
  afterAll(async () => {
    await audit.close()
    await risk.close()
    await admin.end()
  })

  it('persists the superadmin marker as a first-class column', async () => {
    await audit.record({
      event_type: 'superadmin_mutation',
      acting_principal: 'demo:platform-super-admin',
      acting_persona: 'platform-super-admin',
      reason: null,
      trace_id: TRACE,
      superadmin_marker: true,
      justification: 'incident recovery on the reconciliation engine'
    })
    const r = await admin.query(
      `SELECT superadmin_marker, request_body_redacted->>'justification' AS justification
       FROM audit_high_sensitivity WHERE request_trace_id = $1`,
      [TRACE]
    )
    expect(r.rows[0].superadmin_marker).toBe(true)
    expect(r.rows[0].justification).toContain('incident recovery')
  })

  it('the monthly Compliance review view surfaces super-admin activity', async () => {
    const r = await admin.query(
      `SELECT month, acting_principal, event_type, event_count::int AS n
       FROM superadmin_activity_review WHERE acting_principal = 'demo:platform-super-admin'`
    )
    expect(r.rows.length).toBeGreaterThan(0)
    expect(r.rows[0].n).toBeGreaterThan(0)
  })

  it('writes risk signals under the constrained role (RLS binds)', async () => {
    await risk.record({
      signal_type: 'agent_anomaly',
      severity: 'info',
      acting_principal: 'demo:platform-super-admin',
      summary: 'super-admin session active',
      trace_id: TRACE
    })
    const r = await admin.query(
      `SELECT signal_type, severity, status FROM risk_signal WHERE signal_data->>'trace_id' = $1`,
      [TRACE]
    )
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ signal_type: 'agent_anomaly', severity: 'info', status: 'open' })
  })

  it('recordOnce writes one signal per dedup key per window — even under a concurrent fan-out', async () => {
    const key = `superadmin_session:${crypto.randomUUID()}`
    const event = {
      signal_type: 'agent_anomaly',
      severity: 'info',
      acting_principal: 'demo:platform-super-admin',
      summary: 'super-admin session active',
      trace_id: TRACE,
      dedup_key: key
    }
    const since = new Date(Date.now() - 60_000).toISOString()
    // one emitter per "request", as the Worker constructs them
    const emitters = Array.from({ length: 5 }, () => new PgRiskSignalEmitter(url!, { bankId: BANK, channel: 'internal_retail' }))
    try {
      const inserted = await Promise.all(emitters.map((e) => e.recordOnce(event, since)))
      expect(inserted.filter(Boolean)).toHaveLength(1)
      expect(await risk.recordOnce(event, since)).toBe(false)
      const r = await admin.query(`SELECT count(*)::int AS n FROM risk_signal WHERE signal_data->>'dedup_key' = $1`, [key])
      expect(r.rows[0].n).toBe(1)
      // a window that starts after the existing signal lets the next session raise again
      expect(await risk.recordOnce(event, new Date(Date.now() + 1000).toISOString())).toBe(true)
    } finally {
      await Promise.all(emitters.map((e) => e.close()))
    }
  })

  it('recordOnce runs onFirst under the lock: a throw records nothing, a result lands in signal_data', async () => {
    const key = `superadmin_session:${crypto.randomUUID()}`
    const event = {
      signal_type: 'agent_anomaly',
      severity: 'info',
      acting_principal: 'demo:platform-super-admin',
      summary: 'super-admin session active',
      trace_id: TRACE,
      dedup_key: key
    }
    const since = new Date(Date.now() - 60_000).toISOString()
    await expect(risk.recordOnce(event, since, async () => { throw new Error('ITSM unavailable') })).rejects.toThrow('ITSM unavailable')
    const none = await admin.query(`SELECT count(*)::int AS n FROM risk_signal WHERE signal_data->>'dedup_key' = $1`, [key])
    expect(none.rows[0].n).toBe(0)

    let calls = 0
    const onFirst = async () => (calls++, { itsm_ticket_id: 'itsm-42' })
    expect(await risk.recordOnce(event, since, onFirst)).toBe(true)
    expect(await risk.recordOnce(event, since, onFirst)).toBe(false)
    expect(calls).toBe(1) // not raised again once the signal exists
    const row = await admin.query(`SELECT signal_data FROM risk_signal WHERE signal_data->>'dedup_key' = $1`, [key])
    expect(row.rows[0].signal_data.itsm_ticket_id).toBe('itsm-42')
  })

  it('finds pre-dedupe duplicates (all but the earliest per principal per 8h window) and closes only still-open ones', async () => {
    const principal = `demo:sa-backlog-${crypto.randomUUID()}`
    const insert = async (createdAt: string, extra: Record<string, unknown> = {}) =>
      (await admin.query(
        `INSERT INTO risk_signal (bank_id, channel, signal_type, severity, status, signal_data, created_at)
         VALUES ($1, 'internal_retail', 'agent_anomaly', 'info', 'open', $2::jsonb, $3) RETURNING id`,
        [BANK, JSON.stringify({ acting_principal: principal, summary: 'super-admin session active', trace_id: 't', ...extra }), createdAt]
      )).rows[0].id as string
    // 8h buckets are epoch-aligned: 00:00–08:00 UTC is one window
    const first = await insert('2001-01-01T01:00:00Z')
    const dupA = await insert('2001-01-01T02:00:00Z')
    const dupB = await insert('2001-01-01T03:00:00Z')
    const nextWindow = await insert('2001-01-01T09:00:00Z')
    const deduped = await insert('2001-01-01T01:30:00Z', { dedup_key: 'superadmin_session:x' })

    const store = new PgRiskMetricsStore(url!, { bankId: BANK, channel: 'internal_retail' })
    try {
      const ids = await store.duplicateSuperAdminSessionSignalIds(500)
      expect(ids).toEqual(expect.arrayContaining([dupA, dupB]))
      expect(ids).not.toEqual(expect.arrayContaining([first]))
      for (const kept of [first, nextWindow, deduped]) expect(ids).not.toContain(kept)

      expect((await store.transitionSignalStatus(dupA, 'open', 'closed_no_action'))?.status).toBe('closed_no_action')
      // already moved on → no-op, so an analyst's triage is never overwritten
      expect(await store.transitionSignalStatus(dupA, 'open', 'closed_no_action')).toBeNull()
      expect(await store.duplicateSuperAdminSessionSignalIds(500)).not.toContain(dupA)
    } finally {
      await store.close()
    }
  })
})
