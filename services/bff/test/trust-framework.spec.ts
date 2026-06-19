import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-74 — Trust Framework participant administration. GET list/detail
 * (platform:operations:read); POST register + :nominate-replacement
 * (platform:operations:write). No PSU PII (holder names are internal role-holders).
 */

const ops = (extra: Record<string, string> = {}) => ({ ...FAPI_HEADERS, authorization: 'Bearer demo-token:operations-analyst', 'content-type': 'application/json', ...extra })

function appWith() {
  const audit = new InMemoryHighClassAuditSink()
  return { app: createApp({ highClassAudit: audit }), audit }
}

const body = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ role: 'pbc', organisation_id: 'ORG-BANK-1', holder_ref: 'emp-001', holder_display_name: 'Alex Operator', onboarding_stage: 'sandbox', ...extra })

type Wire = {
  id: string
  role: string
  status: string
  individual_tnc_status: string
  organisational_tnc_status: string
  onboarding_stage_due_at: string | null
  onboarding_stage_overdue: boolean
  nominated_replacement_ref: string | null
}

async function register(app: ReturnType<typeof createApp>, key: string, extra: Record<string, unknown> = {}): Promise<Wire> {
  const res = await app.request('/back-office/trust-framework/participants', { method: 'POST', headers: ops({ 'idempotency-key': key }), body: body(extra) })
  expect(res.status).toBe(201)
  return ((await res.json()) as { data: Wire }).data
}

describe('POST /back-office/trust-framework/participants', () => {
  it('registers a role-holder (201): status active, T&C not_started, stage SLA set, one audit', async () => {
    const { app, audit } = appWith()
    const rec = await register(app, 'p1')
    expect(rec.role).toBe('pbc')
    expect(rec.status).toBe('active')
    expect(rec.individual_tnc_status).toBe('not_started')
    expect(rec.organisational_tnc_status).toBe('not_started')
    expect(rec.onboarding_stage_due_at).not.toBeNull()
    expect(rec.onboarding_stage_overdue).toBe(false) // due ~5bd out
    expect(audit.events).toHaveLength(1)
    expect(audit.events[0]).toMatchObject({ event_type: 'trust_framework_participant_registered' })
  })

  it('validates the body (400): missing fields, invalid role', async () => {
    const { app } = appWith()
    expect((await app.request('/back-office/trust-framework/participants', { method: 'POST', headers: ops({ 'idempotency-key': 'p2' }), body: JSON.stringify({ role: 'pbc' }) })).status).toBe(400)
    expect((await app.request('/back-office/trust-framework/participants', { method: 'POST', headers: ops({ 'idempotency-key': 'p3' }), body: body({ role: 'not_a_role' }) })).status).toBe(400)
  })

  it('requires Idempotency-Key (400) and replays without a duplicate audit', async () => {
    const { app, audit } = appWith()
    expect((await app.request('/back-office/trust-framework/participants', { method: 'POST', headers: ops(), body: body() })).status).toBe(400)
    const a = await app.request('/back-office/trust-framework/participants', { method: 'POST', headers: ops({ 'idempotency-key': 'p4' }), body: body() })
    const b = await app.request('/back-office/trust-framework/participants', { method: 'POST', headers: ops({ 'idempotency-key': 'p4' }), body: body() })
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    expect(audit.events).toHaveLength(1)
  })

  it('rejects a persona without platform:operations:write (403)', async () => {
    const { app } = appWith()
    const res = await app.request('/back-office/trust-framework/participants', {
      method: 'POST',
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst', 'content-type': 'application/json', 'idempotency-key': 'p5' },
      body: body()
    })
    expect(res.status).toBe(403)
  })
})

describe('GET /back-office/trust-framework/participants', () => {
  it('lists with {data,meta} and filters by role + status', async () => {
    const { app } = appWith()
    await register(app, 'l1', { role: 'org_admin' })
    const res = await app.request('/back-office/trust-framework/participants', { headers: ops() })
    expect(res.status).toBe(200)
    const list = (await res.json()) as { data: Wire[]; meta: { next_cursor: string | null } }
    expect(list.data.length).toBeGreaterThanOrEqual(1)
    expect(list.meta).toHaveProperty('next_cursor')
    const byRole = await app.request('/back-office/trust-framework/participants?role=org_admin', { headers: ops() })
    expect(((await byRole.json()) as { data: Wire[] }).data.every((r) => r.role === 'org_admin')).toBe(true)
    const departing = await app.request('/back-office/trust-framework/participants?status=departing', { headers: ops() })
    expect(((await departing.json()) as { data: Wire[] }).data).toHaveLength(0)
  })

  it('detail by id (200) + 404 unknown; read rejects finance-analyst (403)', async () => {
    const { app } = appWith()
    const rec = await register(app, 'd1')
    expect((await app.request(`/back-office/trust-framework/participants/${rec.id}`, { headers: ops() })).status).toBe(200)
    expect((await app.request('/back-office/trust-framework/participants/4d2c2e2a-0000-4000-8000-000000000000', { headers: ops() })).status).toBe(404)
    expect((await app.request('/back-office/trust-framework/participants', { headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst' } })).status).toBe(403)
  })
})

describe('POST /back-office/trust-framework/participants/{id}:nominate-replacement', () => {
  const nominate = (app: ReturnType<typeof createApp>, id: string, payload: Record<string, unknown>, key: string) =>
    app.request(`/back-office/trust-framework/participants/${id}:nominate-replacement`, { method: 'POST', headers: ops({ 'idempotency-key': key }), body: JSON.stringify(payload) })

  it('marks the participant departing and records the nominated replacement (200) + one audit', async () => {
    const { app, audit } = appWith()
    const rec = await register(app, 'n1')
    audit.events.length = 0
    const res = await nominate(app, rec.id, { replacement_holder_ref: 'emp-999', replacement_display_name: 'Sam Successor', note: 'Outgoing PBC departs end of month; successor nominated.' }, 'nom1')
    expect(res.status).toBe(200)
    const data = ((await res.json()) as { data: Wire }).data
    expect(data.status).toBe('departing')
    expect(data.nominated_replacement_ref).toBe('emp-999')
    expect(audit.events).toHaveLength(1)
    expect(audit.events[0]).toMatchObject({ event_type: 'trust_framework_replacement_nominated' })
  })

  it('404 unknown id; 400 on a too-short note / missing fields', async () => {
    const { app } = appWith()
    const rec = await register(app, 'n2')
    expect((await nominate(app, '4d2c2e2a-0000-4000-8000-000000000000', { replacement_holder_ref: 'x', replacement_display_name: 'Y', note: 'A sufficiently long replacement note here.' }, 'nom2')).status).toBe(404)
    expect((await nominate(app, rec.id, { replacement_holder_ref: 'x', replacement_display_name: 'Y', note: 'too short' }, 'nom3')).status).toBe(400)
  })
})
