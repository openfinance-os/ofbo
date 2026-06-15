import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { applyMigrations, PgAuditEmitter, PgConsentEventReader } from '@ofbo/db'
import { createApp } from '../src/app.js'

/**
 * BACKOFFICE-19 integration: the consent audit-trail reads consent lifecycle
 * events from the High-class store under RLS, chronologically, with a working
 * keyset cursor. Self-contained — emits its own events under unique ids so it is
 * isolated from the shared integration DB. Read-only — the reader never mutates.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const PSU = `cust-int-${randomUUID()}`
const CONSENT_A = randomUUID()
const CONSENT_B = randomUUID()

describe('consent audit-trail (read over the High-class events)', () => {
  const emitter = new PgAuditEmitter(url!, TENANCY)
  const reader = new PgConsentEventReader(url!, TENANCY)
  const app = createApp({ consentEventSource: reader })
  const care = {
    'x-fapi-interaction-id': randomUUID(),
    authorization: 'Bearer demo-token:customer-care-agent'
  }

  beforeAll(async () => {
    await applyMigrations(url!)
    // A small lifecycle: A granted then revoked; B granted — all for one PSU.
    for (const ev of [
      { event_type: 'consent_granted', target_consent_id: CONSENT_A },
      { event_type: 'consent_revoked', target_consent_id: CONSENT_A },
      { event_type: 'consent_granted', target_consent_id: CONSENT_B }
    ]) {
      await emitter.emit({
        event_type: ev.event_type,
        acting_principal: 'demo:customer-care-agent',
        acting_persona: 'customer-care-agent',
        scope_used: 'consents:admin',
        target_psu_identifier: PSU,
        target_consent_id: ev.target_consent_id,
        request_trace_id: randomUUID(),
        request_body: {},
        response_status: 200
      })
    }
  })
  afterAll(async () => {
    await emitter.close()
    await reader.close()
  })

  it('returns the PSU-wide timeline scoped to that PSU (RLS + filter)', async () => {
    const res = await app.request(`/psu/${PSU}/audit-trail`, { headers: care })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Array<{ psu_identifier: string; event_type: string; id: string }> }
    expect(body.data).toHaveLength(3)
    expect(body.data.every((e) => e.psu_identifier === PSU)).toBe(true)
    expect(body.data.every((e) => ['granted', 'accessed', 'modified', 'revoked'].includes(e.event_type))).toBe(true)
    expect(body.data.every((e) => typeof e.id === 'string')).toBe(true) // drill-down anchor
  })

  it('returns a single consent timeline keyed to the consent id', async () => {
    const res = await app.request(`/consents/${CONSENT_A}/audit-trail`, { headers: care })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Array<{ consent_id: string; event_type: string }> }
    expect(body.data).toHaveLength(2) // granted + revoked
    expect(body.data.every((e) => e.consent_id === CONSENT_A)).toBe(true)
    expect(body.data.map((e) => e.event_type)).toContain('revoked')
  })

  it('paginates with a keyset cursor that advances without overlap', async () => {
    const first = await app.request(`/psu/${PSU}/audit-trail?limit=2`, { headers: care })
    const firstBody = (await first.json()) as { data: Array<{ id: string }>; meta: { next_cursor: string | null } }
    expect(firstBody.data).toHaveLength(2)
    expect(firstBody.meta.next_cursor).toBeTruthy()

    const second = await app.request(
      `/psu/${PSU}/audit-trail?limit=2&cursor=${encodeURIComponent(firstBody.meta.next_cursor!)}`,
      { headers: care }
    )
    const secondBody = (await second.json()) as { data: Array<{ id: string }>; meta: { next_cursor: string | null } }
    expect(secondBody.data).toHaveLength(1) // 3 total, 2 + 1
    expect(secondBody.meta.next_cursor).toBeNull()
    const firstIds = new Set(firstBody.data.map((e) => e.id))
    expect(secondBody.data.every((e) => !firstIds.has(e.id))).toBe(true)
  })
})
