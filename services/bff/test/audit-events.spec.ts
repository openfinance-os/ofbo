import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryAuditEventReader } from '../src/audit/events.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import type { StoredAuditEvent } from '@ofbo/db'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-42 — audit-trail drill-down: signal/report → underlying High-class audit
 * record, audit:read enforced, the drill-down access itself logged.
 */

const auth = (persona: string) => ({ ...FAPI_HEADERS, authorization: `Bearer demo-token:${persona}` })

const ev = (over: Partial<StoredAuditEvent>): StoredAuditEvent => ({
  id: '11111111-1111-4111-8111-000000000001',
  event_type: 'consent_revoked',
  acting_principal: 'demo:care',
  acting_persona: 'customer-care-agent',
  scope_used: 'consents:admin',
  target_psu_identifier: 'BCID-001',
  target_consent_id: null,
  target_dispute_id: null,
  request_trace_id: 't-1',
  superadmin_marker: false,
  request_body_redacted: { reason_code: 'TPP_REQUEST' },
  response_status: 200,
  created_at: '2026-06-15T10:00:00.000Z',
  ...over
})

const rows: StoredAuditEvent[] = [
  ev({ id: '11111111-1111-4111-8111-000000000001', event_type: 'consent_revoked', created_at: '2026-06-15T10:00:00.000Z' }),
  ev({ id: '11111111-1111-4111-8111-000000000002', event_type: 'risk_signal_emitted', acting_principal: 'system:detector', created_at: '2026-06-15T11:00:00.000Z' })
]

function app(audit = new InMemoryHighClassAuditSink()) {
  return { app: createApp({ auditEventReader: new InMemoryAuditEventReader(rows), highClassAudit: audit }), audit }
}

describe('GET /audit/events (drill-down query)', () => {
  it('returns the full audit records for audit:read + logs the drill-down access', async () => {
    const { app: a, audit } = app()
    const res = await a.request('/audit/events', { headers: auth('compliance-officer') })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { id: string; request_body_redacted: unknown; target_psu_identifier: string }[] }
    expect(body.data.length).toBe(2)
    expect(body.data[0]).toHaveProperty('request_body_redacted')
    // the drill-down access is itself logged
    expect(audit.events.some((e) => e.event_type === 'audit_trail_accessed')).toBe(true)
  })

  it('filters by event_type', async () => {
    const { app: a } = app()
    const res = await a.request('/audit/events?event_type=risk_signal_emitted', { headers: auth('compliance-officer') })
    const body = (await res.json()) as { data: { event_type: string }[] }
    expect(body.data).toHaveLength(1)
    expect(body.data[0]!.event_type).toBe('risk_signal_emitted')
  })

  it('rejects a persona without audit:read (403)', async () => {
    const { app: a } = app()
    const res = await a.request('/audit/events', { headers: auth('finance-analyst') })
    expect(res.status).toBe(403)
  })
})

describe('GET /audit/events/{event_id} (single record drill-down)', () => {
  it('returns one record + logs the access', async () => {
    const { app: a, audit } = app()
    const res = await a.request('/audit/events/11111111-1111-4111-8111-000000000001', { headers: auth('customer-care-agent') })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { data: { id: string } }).data.id).toBe('11111111-1111-4111-8111-000000000001')
    expect(audit.events.some((e) => e.event_type === 'audit_trail_accessed')).toBe(true)
  })

  it('404 for an unknown event', async () => {
    const { app: a } = app()
    const res = await a.request('/audit/events/4d2c2e2a-0000-4000-8000-000000000000', { headers: auth('compliance-officer') })
    expect(res.status).toBe(404)
  })

  it('rejects a persona without audit:read (403)', async () => {
    const { app: a } = app()
    const res = await a.request('/audit/events/11111111-1111-4111-8111-000000000001', { headers: auth('finance-analyst') })
    expect(res.status).toBe(403)
  })
})
