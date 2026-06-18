import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { clockStatus, overallStatus } from '../src/respondent-disputes/service.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-75 — respondent-side Nebras dispute scheme clocks. The bank is the
 * RESPONDENT in a Nebras-raised dispute, bound to scheme clocks (response 3 bd,
 * formal resolution 15 bd, appeal 3 bd of verdict, implementation 3 bd of final
 * verdict; BD-16). Owned by Finance (finance:disputes:write). No PSU PII.
 */

const fin = (extra: Record<string, string> = {}) => ({
  ...FAPI_HEADERS,
  authorization: 'Bearer demo-token:finance-analyst',
  'content-type': 'application/json',
  ...extra
})
// customer-care holds disputes:admin but NOT finance:disputes:write
const care = (extra: Record<string, string> = {}) => ({
  ...FAPI_HEADERS,
  authorization: 'Bearer demo-token:customer-care-agent',
  'content-type': 'application/json',
  ...extra
})

const RAISED = '2026-06-01T09:00:00.000Z' // a Monday
const body = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ nebras_dispute_ref: 'NBR-DISP-001', category: 'billing', raised_at: RAISED, ...extra })

function appWith() {
  const audit = new InMemoryHighClassAuditSink()
  return { app: createApp({ highClassAudit: audit }), audit }
}

type Wire = {
  id: string
  state: string
  nebras_dispute_ref: string
  category: string
  raised_at: string
  response_due_at: string
  resolution_due_at: string
  responded_at: string | null
  resolved_at: string | null
  appeal_due_at: string | null
  implementation_due_at: string | null
  implemented_at: string | null
  response_clock_status: string
  resolution_clock_status: string
  appeal_clock_status: string
  implementation_clock_status: string
  overall_breach_status: string
  verdict_outcome: string | null
}

async function register(app: ReturnType<typeof createApp>, key: string, extra: Record<string, unknown> = {}): Promise<Wire> {
  const res = await app.request('/back-office/disputes/respondent', { method: 'POST', headers: fin({ 'idempotency-key': key }), body: body(extra) })
  expect(res.status).toBe(201)
  return ((await res.json()) as { data: Wire }).data
}

describe('clock-status pure logic (BACKOFFICE-75)', () => {
  const now = new Date('2026-06-10T12:00:00.000Z')
  it('on_track when the clock has not started (no due date)', () => {
    expect(clockStatus(null, null, now)).toBe('on_track')
  })
  it('on_track when due is comfortably in the future', () => {
    expect(clockStatus('2026-06-20T12:00:00.000Z', null, now)).toBe('on_track')
  })
  it('amber within the warning window before due', () => {
    expect(clockStatus('2026-06-11T06:00:00.000Z', null, now)).toBe('amber')
  })
  it('red once past due (breach)', () => {
    expect(clockStatus('2026-06-09T12:00:00.000Z', null, now)).toBe('red')
  })
  it('a stopped clock is on_track when met before due, red when met late', () => {
    expect(clockStatus('2026-06-12T00:00:00.000Z', '2026-06-11T00:00:00.000Z', now)).toBe('on_track')
    expect(clockStatus('2026-06-09T00:00:00.000Z', '2026-06-11T00:00:00.000Z', now)).toBe('red')
  })
  it('overall is the worst of the clocks', () => {
    expect(overallStatus(['on_track', 'amber', 'on_track'])).toBe('amber')
    expect(overallStatus(['on_track', 'amber', 'red'])).toBe('red')
    expect(overallStatus(['on_track', 'on_track'])).toBe('on_track')
  })
})

describe('POST /back-office/disputes/respondent', () => {
  it('registers a respondent dispute (201), starts response (3bd) + resolution (15bd) clocks, writes one audit', async () => {
    const { app, audit } = appWith()
    const rec = await register(app, 'r1')
    expect(rec.state).toBe('received')
    expect(rec.nebras_dispute_ref).toBe('NBR-DISP-001')
    // 2026-06-01 (Mon) + 3 bd = Thu 2026-06-04; + 15 bd = Mon 2026-06-22
    expect(rec.response_due_at.slice(0, 10)).toBe('2026-06-04')
    expect(rec.resolution_due_at.slice(0, 10)).toBe('2026-06-22')
    expect(rec.appeal_due_at).toBeNull()
    expect(rec.implementation_due_at).toBeNull()
    expect(audit.events).toHaveLength(1)
    expect(audit.events[0]).toMatchObject({ event_type: 'respondent_dispute_registered', target_dispute_id: rec.id })
  })

  it('requires Idempotency-Key (400) and replays without a duplicate (one audit)', async () => {
    const { app, audit } = appWith()
    expect((await app.request('/back-office/disputes/respondent', { method: 'POST', headers: fin(), body: body() })).status).toBe(400)
    const first = await app.request('/back-office/disputes/respondent', { method: 'POST', headers: fin({ 'idempotency-key': 'r2' }), body: body() })
    const second = await app.request('/back-office/disputes/respondent', { method: 'POST', headers: fin({ 'idempotency-key': 'r2' }), body: body() })
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(((await first.json()) as { data: Wire }).data.id).toBe(((await second.json()) as { data: Wire }).data.id)
    expect(audit.events).toHaveLength(1)
  })

  it('rejects a persona lacking finance:disputes:write (403)', async () => {
    const { app } = appWith()
    const res = await app.request('/back-office/disputes/respondent', { method: 'POST', headers: care({ 'idempotency-key': 'r3' }), body: body() })
    expect(res.status).toBe(403)
  })

  it('validates the body (400) when required fields are missing', async () => {
    const { app } = appWith()
    const res = await app.request('/back-office/disputes/respondent', {
      method: 'POST',
      headers: fin({ 'idempotency-key': 'r4' }),
      body: JSON.stringify({ category: 'billing' })
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /back-office/disputes/respondent (list + detail)', () => {
  it('lists with the {data,meta} envelope and filters by state', async () => {
    const { app } = appWith()
    await register(app, 'l1')
    const res = await app.request('/back-office/disputes/respondent', { headers: fin() })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Wire[]; meta: { next_cursor: string | null } }
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBeGreaterThanOrEqual(1)
    expect(body.meta).toHaveProperty('next_cursor')
    const filtered = await app.request('/back-office/disputes/respondent?state=resolved', { headers: fin() })
    expect(filtered.status).toBe(200)
    expect(((await filtered.json()) as { data: Wire[] }).data).toHaveLength(0)
  })

  it('returns a detail by id (200) and 404 for an unknown id', async () => {
    const { app } = appWith()
    const rec = await register(app, 'd1')
    const ok = await app.request(`/back-office/disputes/respondent/${rec.id}`, { headers: fin() })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { data: Wire }).data.id).toBe(rec.id)
    const miss = await app.request('/back-office/disputes/respondent/4d2c2e2a-0000-4000-8000-000000000000', { headers: fin() })
    expect(miss.status).toBe(404)
  })
})

describe('POST /back-office/disputes/respondent/{id}:advance', () => {
  const advance = (app: ReturnType<typeof createApp>, id: string, payload: Record<string, unknown>, key: string) =>
    app.request(`/back-office/disputes/respondent/${id}:advance`, { method: 'POST', headers: fin({ 'idempotency-key': key }), body: JSON.stringify(payload) })

  it('respond stops the response clock and writes one audit', async () => {
    const { app, audit } = appWith()
    const rec = await register(app, 'a1')
    audit.events.length = 0
    const res = await advance(app, rec.id, { action: 'respond', note: 'Filed the bank response with Nebras.' }, 'adv1')
    expect(res.status).toBe(200)
    const data = ((await res.json()) as { data: Wire }).data
    expect(data.state).toBe('responded')
    expect(data.responded_at).not.toBeNull()
    expect(audit.events).toHaveLength(1)
    expect(audit.events[0]).toMatchObject({ event_type: 'respondent_dispute_advanced', target_dispute_id: rec.id })
  })

  it('record_verdict requires a verdict_outcome (400) and starts the appeal clock', async () => {
    const { app } = appWith()
    const rec = await register(app, 'a2')
    await advance(app, rec.id, { action: 'respond', note: 'Filed the bank response with Nebras.' }, 'adv2a')
    const missing = await advance(app, rec.id, { action: 'record_verdict', note: 'Verdict received from the scheme today.' }, 'adv2b')
    expect(missing.status).toBe(400)
    const ok = await advance(app, rec.id, { action: 'record_verdict', note: 'Verdict received from the scheme today.', verdict_outcome: 'partially_upheld' }, 'adv2c')
    expect(ok.status).toBe(200)
    const data = ((await ok.json()) as { data: Wire }).data
    expect(data.state).toBe('resolved')
    expect(data.resolved_at).not.toBeNull()
    expect(data.appeal_due_at).not.toBeNull()
    expect(data.verdict_outcome).toBe('partially_upheld')
  })

  it('rejects an illegal transition (409) and a too-short note (400)', async () => {
    const { app } = appWith()
    const rec = await register(app, 'a3')
    const illegal = await advance(app, rec.id, { action: 'implement', note: 'Trying to implement before any verdict.' }, 'adv3a')
    expect(illegal.status).toBe(409)
    const shortNote = await advance(app, rec.id, { action: 'respond', note: 'too short' }, 'adv3b')
    expect(shortNote.status).toBe(400)
  })

  it('requires Idempotency-Key (400) on advance', async () => {
    const { app } = appWith()
    const rec = await register(app, 'a4')
    const res = await app.request(`/back-office/disputes/respondent/${rec.id}:advance`, {
      method: 'POST',
      headers: fin(),
      body: JSON.stringify({ action: 'respond', note: 'Filed the bank response with Nebras.' })
    })
    expect(res.status).toBe(400)
  })
})
