import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { RiskViewService, type RiskViewDeps } from '../src/analytics/risk-view.js'
import { ScopeDeniedError } from '../src/rbac.js'
import type { Principal } from '../src/auth.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-30 — Risk View: consent anomaly signals, TPP behavioural anomalies,
 * the proactive Nebras-liability monitor — risk:read, freshness envelope. Typed
 * signal headers + counts only (no raw signal_data / PSU PII).
 */

const risk: Principal = { subject: 'demo:risk', persona: 'risk-analyst', scopes: ['risk:read'] }
const care: Principal = { subject: 'demo:care', persona: 'customer-care-agent', scopes: ['consents:admin'] }

function svc(over: Partial<RiskViewDeps> = {}) {
  return new RiskViewService({
    metrics: {
      summary: async () => ({
        active_total: 6,
        by_type: { consent_anomaly: 2, cop_mismatch_spike: 1, tpp_behaviour: 2, nebras_liability_approach: 1 },
        by_severity: { high: 2, medium: 3, low: 1 },
        by_status: { open: 4, investigating: 2, closed_no_action: 5 }
      }),
      liabilityMonitor: async () => ({ open_count: 1, by_severity: { high: 1 }, recent: [{ nebras_liability_event_ref: 'consent_state_failure|LFI|500', severity: 'high', created_at: '2026-06-15T09:00:00.000Z' }] }),
      recentActive: async () => [{ id: 's1', signal_type: 'tpp_behaviour', severity: 'high', status: 'open', client_id: 'org-1', nebras_liability_event_ref: null, created_at: '2026-06-15T10:00:00.000Z' }]
    },
    now: () => new Date('2026-06-15T12:00:00.000Z'),
    ...over
  })
}

describe('RiskViewService — composition', () => {
  it('summarizes signals, derives consent + TPP anomaly counts, surfaces the liability monitor', async () => {
    const { data, freshness } = await svc().view(risk)
    expect((data.signal_summary as { active_total: number }).active_total).toBe(6)
    // consent_anomaly(2) + cop_mismatch_spike(1) = 3
    expect((data.consent_anomalies as { active: number }).active).toBe(3)
    // tpp_behaviour(2) + agent_anomaly(0) = 2
    expect((data.tpp_behaviour_anomalies as { active: number }).active).toBe(2)
    const liability = data.liability_monitor as { open_count: number; recent: { nebras_liability_event_ref: string }[] }
    expect(liability.open_count).toBe(1)
    expect(liability.recent[0]!.nebras_liability_event_ref).toBe('consent_state_failure|LFI|500')
    expect((data.recent_signals as unknown[]).length).toBe(1)
    expect(freshness.stale).toBe(false)
    expect(freshness.view_refreshed_at).toBe('2026-06-15T12:00:00.000Z')
  })

  it('does not surface raw signal_data (PII safety) — recent_signals carry typed fields only', async () => {
    const { data } = await svc().view(risk)
    const header = (data.recent_signals as Record<string, unknown>[])[0]!
    expect(Object.keys(header).sort()).toEqual(['client_id', 'created_at', 'id', 'nebras_liability_event_ref', 'severity', 'signal_type', 'status'])
    expect(header).not.toHaveProperty('signal_data')
  })

  it('rejects a principal without risk:read (defence in depth)', async () => {
    await expect(svc().view(care)).rejects.toBeInstanceOf(ScopeDeniedError)
  })
})

describe('GET /back-office/analytics/risk-view (HTTP)', () => {
  const app = createApp()
  const auth = (persona: string) => ({ ...FAPI_HEADERS, authorization: `Bearer demo-token:${persona}` })

  it('returns 200 with the AnalyticsView envelope for risk-analyst', async () => {
    const res = await app.request('/back-office/analytics/risk-view', { headers: auth('risk-analyst') })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Record<string, unknown>; meta: { request_id: string }; freshness: { stale: boolean } }
    expect(body.meta.request_id).toBeTruthy()
    expect(body.data).toHaveProperty('signal_summary')
    expect(body.data).toHaveProperty('liability_monitor')
    expect(body.freshness).toHaveProperty('stale')
  })

  it('rejects a wrong-scope persona at the BFF middleware (403)', async () => {
    const res = await app.request('/back-office/analytics/risk-view', { headers: auth('customer-care-agent') })
    expect(res.status).toBe(403)
  })
})
