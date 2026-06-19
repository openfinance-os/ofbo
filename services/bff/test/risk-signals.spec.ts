import { describe, expect, it } from 'vitest'
import type { StoredRiskSignal } from '@ofbo/db'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { InMemoryRiskSignalStore } from '../src/risk-signals/service.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-30 / -42 — risk-signal list (risk:read) + triage (risk:investigations:write).
 */
const risk = (extra: Record<string, string> = {}) => ({ ...FAPI_HEADERS, authorization: 'Bearer demo-token:risk-analyst', 'content-type': 'application/json', ...extra })

function sig(id: string, over: Partial<StoredRiskSignal> = {}): StoredRiskSignal {
  return { id, signal_type: 'consent_anomaly', severity: 'high', status: 'open', client_id: null, channel: 'internal_retail', signal_data: {}, nebras_liability_event_ref: null, created_at: `2026-06-${10 + Number(id.slice(-1))}T00:00:00.000Z`, ...over }
}

function appWith(seed: StoredRiskSignal[] = []) {
  const audit = new InMemoryHighClassAuditSink()
  return { app: createApp({ highClassAudit: audit, riskSignalStore: new InMemoryRiskSignalStore(seed) }), audit }
}

describe('GET /back-office/risk-signals', () => {
  it('lists signals with {data,meta} (risk:read) and filters by status/severity/type', async () => {
    const { app } = appWith([sig('sig-1'), sig('sig-2', { severity: 'low', status: 'acknowledged' }), sig('sig-3', { signal_type: 'tpp_behaviour' })])
    const res = await app.request('/back-office/risk-signals', { headers: risk() })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: StoredRiskSignal[]; meta: { next_cursor: string | null } }
    expect(body.data.length).toBe(3)
    expect(body.meta).toHaveProperty('next_cursor')
    expect(((await (await app.request('/back-office/risk-signals?severity=low', { headers: risk() })).json()) as { data: StoredRiskSignal[] }).data.every((s) => s.severity === 'low')).toBe(true)
    expect(((await (await app.request('/back-office/risk-signals?signal_type=tpp_behaviour', { headers: risk() })).json()) as { data: StoredRiskSignal[] }).data).toHaveLength(1)
  })

  it('rejects a persona without risk:read (403)', async () => {
    const { app } = appWith([sig('sig-1')])
    expect((await app.request('/back-office/risk-signals', { headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst' } })).status).toBe(403)
  })
})

describe('PATCH /back-office/risk-signals/{signal_id}', () => {
  const patch = (app: ReturnType<typeof createApp>, id: string, body: Record<string, unknown>, key: string, persona = 'risk-analyst') =>
    app.request(`/back-office/risk-signals/${id}`, { method: 'PATCH', headers: { ...FAPI_HEADERS, authorization: `Bearer demo-token:${persona}`, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) })

  it('transitions a signal status (200) + one audit (risk:investigations:write)', async () => {
    const { app, audit } = appWith([sig('sig-1')])
    const res = await patch(app, 'sig-1', { status: 'investigating' }, 'k1')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { data: StoredRiskSignal }).data.status).toBe('investigating')
    expect(audit.events.filter((e) => e.event_type === 'risk_signal_status_changed')).toHaveLength(1)
  })

  it('400 invalid status / missing Idempotency-Key; 404 unknown id', async () => {
    const { app } = appWith([sig('sig-1')])
    expect((await patch(app, 'sig-1', { status: 'open' }, 'k2')).status).toBe(400) // open is not a PATCH target
    expect((await patch(app, 'sig-1', { status: 'not_a_status' }, 'k3')).status).toBe(400)
    expect((await app.request('/back-office/risk-signals/sig-1', { method: 'PATCH', headers: risk(), body: JSON.stringify({ status: 'acknowledged' }) })).status).toBe(400) // no idempotency key
    expect((await patch(app, 'nope-404', { status: 'acknowledged' }, 'k4')).status).toBe(404)
  })

  it('rejects a persona without risk:investigations:write (403)', async () => {
    const { app } = appWith([sig('sig-1')])
    expect((await patch(app, 'sig-1', { status: 'acknowledged' }, 'k5', 'finance-analyst')).status).toBe(403)
  })
})
