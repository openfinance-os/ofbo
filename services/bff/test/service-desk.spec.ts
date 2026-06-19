import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-79 — Nebras service-desk case tracking. GET list/detail
 * (platform:operations:read); POST track + :update (platform:operations:write).
 */

const ops = (extra: Record<string, string> = {}) => ({ ...FAPI_HEADERS, authorization: 'Bearer demo-token:operations-analyst', 'content-type': 'application/json', ...extra })

function appWith() {
  const audit = new InMemoryHighClassAuditSink()
  return { app: createApp({ highClassAudit: audit }), audit }
}

const body = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ nebras_case_reference: 'NBR-SD-001', case_type: 'incident', priority: 'P2', summary: 'Ozone Connect latency spike during peak window.', ...extra })

type Wire = { id: string; case_type: string; priority: string; status: string; sla_due_at: string; sla_overdue: boolean; resolved_at: string | null; linked_break_id: string | null }

async function track(app: ReturnType<typeof createApp>, key: string, extra: Record<string, unknown> = {}): Promise<Wire> {
  const res = await app.request('/back-office/service-desk-cases', { method: 'POST', headers: ops({ 'idempotency-key': key }), body: body(extra) })
  expect(res.status).toBe(201)
  return ((await res.json()) as { data: Wire }).data
}

describe('POST /back-office/service-desk-cases', () => {
  it('tracks a case (201): status open, SLA due set, one audit', async () => {
    const { app, audit } = appWith()
    const rec = await track(app, 's1', { linked_break_id: '4d2c2e2a-0000-4000-8000-000000000111' })
    expect(rec.status).toBe('open')
    expect(rec.priority).toBe('P2')
    expect(rec.sla_due_at).not.toBeNull()
    expect(rec.sla_overdue).toBe(false)
    expect(rec.linked_break_id).toBe('4d2c2e2a-0000-4000-8000-000000000111')
    expect(audit.events.filter((e) => e.event_type === 'service_desk_case_tracked')).toHaveLength(1)
  })

  it('validates the body (400): missing fields, invalid case_type, invalid priority', async () => {
    const { app } = appWith()
    expect((await app.request('/back-office/service-desk-cases', { method: 'POST', headers: ops({ 'idempotency-key': 's2' }), body: JSON.stringify({ case_type: 'incident' }) })).status).toBe(400)
    expect((await app.request('/back-office/service-desk-cases', { method: 'POST', headers: ops({ 'idempotency-key': 's3' }), body: body({ case_type: 'nope' }) })).status).toBe(400)
    expect((await app.request('/back-office/service-desk-cases', { method: 'POST', headers: ops({ 'idempotency-key': 's4' }), body: body({ priority: 'P9' }) })).status).toBe(400)
  })

  it('requires Idempotency-Key (400) and replays without a duplicate audit', async () => {
    const { app, audit } = appWith()
    expect((await app.request('/back-office/service-desk-cases', { method: 'POST', headers: ops(), body: body() })).status).toBe(400)
    const a = await app.request('/back-office/service-desk-cases', { method: 'POST', headers: ops({ 'idempotency-key': 's5' }), body: body() })
    const b = await app.request('/back-office/service-desk-cases', { method: 'POST', headers: ops({ 'idempotency-key': 's5' }), body: body() })
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    expect(audit.events).toHaveLength(1)
  })

  it('rejects a persona without platform:operations:write (403)', async () => {
    const { app } = appWith()
    const res = await app.request('/back-office/service-desk-cases', {
      method: 'POST',
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst', 'content-type': 'application/json', 'idempotency-key': 's6' },
      body: body()
    })
    expect(res.status).toBe(403)
  })
})

describe('GET /back-office/service-desk-cases', () => {
  it('lists with {data,meta} and filters by case_type/priority/status', async () => {
    const { app } = appWith()
    await track(app, 'l1', { case_type: 'billing_query', priority: 'P3' })
    const res = await app.request('/back-office/service-desk-cases', { headers: ops() })
    expect(res.status).toBe(200)
    const list = (await res.json()) as { data: Wire[]; meta: { next_cursor: string | null } }
    expect(list.data.length).toBeGreaterThanOrEqual(1)
    expect(list.meta).toHaveProperty('next_cursor')
    expect(((await (await app.request('/back-office/service-desk-cases?case_type=billing_query', { headers: ops() })).json()) as { data: Wire[] }).data.every((r) => r.case_type === 'billing_query')).toBe(true)
    expect(((await (await app.request('/back-office/service-desk-cases?status=closed', { headers: ops() })).json()) as { data: Wire[] }).data).toHaveLength(0)
  })

  it('detail by id (200) + 404 unknown; read rejects finance-analyst (403)', async () => {
    const { app } = appWith()
    const rec = await track(app, 'd1')
    expect((await app.request(`/back-office/service-desk-cases/${rec.id}`, { headers: ops() })).status).toBe(200)
    expect((await app.request('/back-office/service-desk-cases/4d2c2e2a-0000-4000-8000-000000000000', { headers: ops() })).status).toBe(404)
    expect((await app.request('/back-office/service-desk-cases', { headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst' } })).status).toBe(403)
  })
})

describe('POST /back-office/service-desk-cases/{id}:update', () => {
  const update = (app: ReturnType<typeof createApp>, id: string, payload: Record<string, unknown>, key: string) =>
    app.request(`/back-office/service-desk-cases/${id}:update`, { method: 'POST', headers: ops({ 'idempotency-key': key }), body: JSON.stringify(payload) })

  it('updates status/priority (200), stamps resolved_at on resolve, one audit', async () => {
    const { app, audit } = appWith()
    const rec = await track(app, 'u1')
    audit.events.length = 0
    const res = await update(app, rec.id, { status: 'resolved', note: 'Confirmed fixed by Nebras; closing the incident.' }, 'up1')
    expect(res.status).toBe(200)
    const data = ((await res.json()) as { data: Wire }).data
    expect(data.status).toBe('resolved')
    expect(data.resolved_at).not.toBeNull()
    expect(data.sla_overdue).toBe(false) // resolved → not overdue
    expect(audit.events.filter((e) => e.event_type === 'service_desk_case_updated')).toHaveLength(1)
  })

  it('400 on too-short note / invalid status; 404 unknown id', async () => {
    const { app } = appWith()
    const rec = await track(app, 'u2')
    expect((await update(app, rec.id, { status: 'resolved', note: 'short' }, 'up2')).status).toBe(400)
    expect((await update(app, rec.id, { status: 'not_a_status', note: 'A sufficiently long update note here.' }, 'up3')).status).toBe(400)
    expect((await update(app, '4d2c2e2a-0000-4000-8000-000000000000', { status: 'closed', note: 'A sufficiently long update note here.' }, 'up4')).status).toBe(404)
  })
})
