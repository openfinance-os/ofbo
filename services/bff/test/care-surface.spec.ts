import { describe, expect, it } from 'vitest'
import { getAdapter } from '@ofbo/ports'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { FAPI_HEADERS } from './helpers.js'
import type { ConsentDirectory } from '../src/consents/directory.js'

/**
 * BACKOFFICE-25 — POST /care-surface:mint-token (ADR 0001 Option 1). Mints a
 * short-lived care token with act (the authenticated caller) + sub (the PSU
 * resolved to its internal id). consents:admin gated; Idempotency-Key required;
 * exactly one High-class audit, no raw (PII) psu_identifier recorded.
 */

const idp = getAdapter('p2-identity-provider', 'demo')

const directory: ConsentDirectory = {
  search(_type, identifier) {
    if (identifier === 'known-psu') return { psu: { bank_customer_id: 'cust-internal-1', account_count: 2 }, consents: [] }
    return null
  },
  getByConsentId: () => null, // unused by the care-surface service; present to satisfy the port
  psuByConsentId: () => null
}

// Each real mint yields a distinct token, so the idempotency test proves caching
// (not a constant). act/sub echo what the service passes in.
let minted = 0
const careSurface = {
  async mintCareToken({ agent_id, psu_id }: { agent_id: string; psu_id: string }) {
    minted += 1
    return { token: `care-token-${minted}`, act: agent_id, sub: psu_id, expires_at: '2026-06-20T12:15:00.000Z' }
  },
  async resolveCallRecording() {
    return null // unused by the -25 mint-token tests; present to satisfy the widened port dep
  }
}

function appWith() {
  const audit = new InMemoryHighClassAuditSink()
  return { app: createApp({ idp, consentDirectory: directory, careSurface, highClassAudit: audit }), audit }
}

const MINT = '/care-surface:mint-token'
const asPersona = (p: string) => ({ ...FAPI_HEADERS, authorization: `Bearer demo-token:${p}` })
const post = (persona: string, b: unknown, key: string | null = 'k1') =>
  ({
    method: 'POST',
    headers: { ...asPersona(persona), 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
    body: JSON.stringify(b)
  }) as const

describe('BACKOFFICE-25 — care-surface token minting', () => {
  it('mints a token with act=caller, sub=resolved internal id, in the data envelope', async () => {
    const { app } = appWith()
    const res = await app.request(MINT, post('customer-care-agent', { identifier_type: 'bank_customer_id', psu_identifier: 'known-psu' }))
    expect(res.status).toBe(200)
    const j = (await res.json()) as { data: { token: string; act: string; sub: string; expires_at: string } }
    expect(j.data.token).toBeTruthy()
    expect(j.data.sub).toBe('cust-internal-1') // resolved id, never the raw identifier
    expect(j.data.act).toBeTruthy() // the authenticated caller (not the body)
    expect(j.data.expires_at).toBeTruthy()
  })

  it('writes exactly one care_token_minted audit with the resolved sub and no raw psu_identifier', async () => {
    const { app, audit } = appWith()
    await app.request(MINT, post('customer-care-agent', { identifier_type: 'emirates_id', psu_identifier: 'known-psu' }))
    const events = audit.events.filter((e) => e.event_type === 'care_token_minted')
    expect(events).toHaveLength(1)
    expect(events[0]!.target_psu_identifier).toBe('cust-internal-1')
    expect(JSON.stringify(events[0])).not.toContain('known-psu') // raw identifier never recorded
  })

  it('enforces consents:admin at the route (wrong persona → 403)', async () => {
    const { app } = appWith()
    const res = await app.request(MINT, post('risk-analyst', { identifier_type: 'bank_customer_id', psu_identifier: 'known-psu' }))
    expect(res.status).toBe(403)
  })

  it('requires Idempotency-Key; a replay returns the original token', async () => {
    const { app } = appWith()
    const noKey = await app.request(MINT, post('customer-care-agent', { identifier_type: 'bank_customer_id', psu_identifier: 'known-psu' }, null))
    expect(noKey.status).toBe(400)
    const first = await app.request(MINT, post('customer-care-agent', { identifier_type: 'bank_customer_id', psu_identifier: 'known-psu' }, 'replay-key'))
    const second = await app.request(MINT, post('customer-care-agent', { identifier_type: 'bank_customer_id', psu_identifier: 'known-psu' }, 'replay-key'))
    const t1 = ((await first.json()) as { data: { token: string } }).data.token
    const t2 = ((await second.json()) as { data: { token: string } }).data.token
    expect(t2).toBe(t1)
  })

  it('rejects a bad identifier_type (400) and an unknown PSU (404)', async () => {
    const { app } = appWith()
    expect((await app.request(MINT, post('customer-care-agent', { identifier_type: 'passport', psu_identifier: 'known-psu' }))).status).toBe(400)
    expect((await app.request(MINT, post('customer-care-agent', { identifier_type: 'bank_customer_id', psu_identifier: 'nope' }))).status).toBe(404)
  })
})
