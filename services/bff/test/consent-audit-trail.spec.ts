import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import type { ConsentEventSource } from '../src/consents/audit-trail.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-19 — consent audit-trail timeline (per consent + per PSU).
 * Contract tests: envelope + chronological data array, cursor/limit forwarding,
 * next_cursor in meta, audit:read enforced at the BFF layer.
 */

const SAMPLE = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    consent_id: '22222222-2222-4222-8222-222222222222',
    psu_identifier: 'cust-0001',
    event_type: 'granted' as const,
    event_subtype: null,
    event_data: {},
    acting_principal: 'seed',
    created_at: '2026-01-02T03:04:05.000Z'
  }
]

class FakeSource implements ConsentEventSource {
  readonly calls: Array<[string, string, { cursor?: string; limit?: number }]> = []
  async byConsent(consentId: string, query: { cursor?: string; limit?: number }) {
    this.calls.push(['consent', consentId, query])
    return { events: SAMPLE, next_cursor: 'NEXT-CURSOR' }
  }
  async byPsu(psuIdentifier: string, query: { cursor?: string; limit?: number }) {
    this.calls.push(['psu', psuIdentifier, query])
    return { events: SAMPLE, next_cursor: null }
  }
}

const care = () => ({ ...FAPI_HEADERS, authorization: 'Bearer demo-token:customer-care-agent' })

describe('GET /consents/{consent_id}/audit-trail', () => {
  it('returns the chronological event array with next_cursor in meta, forwarding cursor+limit', async () => {
    const source = new FakeSource()
    const app = createApp({ consentEventSource: source })
    const res = await app.request('/consents/22222222-2222-4222-8222-222222222222/audit-trail?limit=1&cursor=abc', {
      headers: care()
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: Array<{ event_type: string; consent_id: string; id: string }>
      meta: { next_cursor: string | null }
    }
    expect(body.data).toHaveLength(1)
    expect(body.data[0]?.event_type).toBe('granted')
    expect(body.data[0]?.id).toBeTruthy() // drill-down anchor
    expect(body.meta.next_cursor).toBe('NEXT-CURSOR')
    expect(source.calls[0]).toEqual(['consent', '22222222-2222-4222-8222-222222222222', { cursor: 'abc', limit: 1 }])
  })

  it('rejects a persona without audit:read at the BFF layer (403)', async () => {
    const app = createApp({ consentEventSource: new FakeSource() })
    const res = await app.request('/consents/22222222-2222-4222-8222-222222222222/audit-trail', {
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:risk-analyst' }
    })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BACKOFFICE.SCOPE_DENIED')
  })
})

describe('GET /psu/{psu_identifier}/audit-trail', () => {
  it('returns the PSU-wide timeline (null next_cursor on the last page)', async () => {
    const source = new FakeSource()
    const app = createApp({ consentEventSource: source })
    const res = await app.request('/psu/cust-0001/audit-trail', { headers: care() })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[]; meta: { next_cursor: string | null } }
    expect(body.data).toHaveLength(1)
    expect(body.meta.next_cursor).toBeNull()
    expect(source.calls[0]).toEqual(['psu', 'cust-0001', {}])
  })

  it('is reachable by Compliance (audit:read) too', async () => {
    const app = createApp({ consentEventSource: new FakeSource() })
    const res = await app.request('/psu/cust-0001/audit-trail', {
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:compliance-officer' }
    })
    expect(res.status).toBe(200)
  })

  it('returns a well-formed empty timeline when no event source is configured (degraded local dev)', async () => {
    const app = createApp() // no consentEventSource → InMemoryConsentEventSource
    const consent = await app.request('/consents/22222222-2222-4222-8222-222222222222/audit-trail', { headers: care() })
    const psu = await app.request('/psu/cust-0001/audit-trail', { headers: care() })
    expect(consent.status).toBe(200)
    expect(psu.status).toBe(200)
    const cBody = (await consent.json()) as { data: unknown[]; meta: { next_cursor: string | null } }
    expect(cBody.data).toEqual([])
    expect(cBody.meta.next_cursor).toBeNull()
    expect(((await psu.json()) as { data: unknown[] }).data).toEqual([])
  })
})
