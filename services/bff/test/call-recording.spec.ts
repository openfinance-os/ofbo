import { describe, expect, it } from 'vitest'
import { getAdapter } from '@ofbo/ports'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { FAPI_HEADERS } from './helpers.js'
import type { DisputeStore } from '../src/disputes/service.js'

/**
 * BACKOFFICE-64 — GET /disputes/{dispute_id}/call-recording (ADR 0003 Option 1).
 * disputes:admin; resolves originating_call_id → a short-lived CallRecording via the
 * P1 port; one High-class call_recording_accessed audit; 404 for unknown dispute,
 * non-voice (no linkage), or an unavailable recording.
 */

const idp = getAdapter('p2-identity-provider', 'demo')

const disputeStore = {
  get: async (id: string) => {
    if (id === 'd-voice') return { id, originating_call_id: 'call-123' }
    if (id === 'd-nonvoice') return { id, originating_call_id: null }
    if (id === 'd-gone') return { id, originating_call_id: 'gone' }
    return null
  }
} as unknown as DisputeStore

const careSurface = {
  mintCareToken: async () => ({ token: 't', act: 'a', sub: 's', expires_at: 'x' }),
  resolveCallRecording: async ({ call_id }: { call_id: string }) =>
    call_id === 'gone'
      ? null
      : { recording_ref: `rec-${call_id}`, recording_url: `https://cc.demo/${call_id}`, expires_at: '2026-06-20T12:15:00.000Z' }
}

function appWith() {
  const audit = new InMemoryHighClassAuditSink()
  return { app: createApp({ idp, disputeStore, careSurface, highClassAudit: audit }), audit }
}

const REC = (id: string) => `/disputes/${id}/call-recording`
const asPersona = (p: string) => ({ ...FAPI_HEADERS, authorization: `Bearer demo-token:${p}` })

describe('BACKOFFICE-64 — dispute call-recording linkage', () => {
  it('resolves a short-lived recording link for a voice dispute + audits the access', async () => {
    const { app, audit } = appWith()
    const res = await app.request(REC('d-voice'), { headers: asPersona('customer-care-agent') })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { data: { recording_ref: string; recording_url: string | null; expires_at: string } }
    expect(j.data.recording_ref).toBe('rec-call-123')
    expect(j.data.recording_url).toBeTruthy()
    expect(j.data.expires_at).toBeTruthy()
    const events = audit.events.filter((e) => e.event_type === 'call_recording_accessed')
    expect(events).toHaveLength(1)
    expect(events[0]!.target_dispute_id).toBe('d-voice')
  })

  it('404s a non-voice dispute (no originating call)', async () => {
    const { app } = appWith()
    expect((await app.request(REC('d-nonvoice'), { headers: asPersona('customer-care-agent') })).status).toBe(404)
  })

  it('404s an unknown dispute and an unavailable recording', async () => {
    const { app } = appWith()
    expect((await app.request(REC('d-missing'), { headers: asPersona('customer-care-agent') })).status).toBe(404)
    expect((await app.request(REC('d-gone'), { headers: asPersona('customer-care-agent') })).status).toBe(404)
  })

  it('enforces disputes:admin (wrong persona → 403)', async () => {
    const { app } = appWith()
    expect((await app.request(REC('d-voice'), { headers: asPersona('risk-analyst') })).status).toBe(403)
  })
})
