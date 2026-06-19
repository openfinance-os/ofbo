import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { noticeRequiredDays, noticeDeadline } from '../src/scheme-notifications/service.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-78 — outbound downtime/change notifications to Nebras. 10-day notice for
 * planned maintenance / version releases; 30-day + dual-running for breaking changes.
 * GET is platform:operations:read; POST + :acknowledge are platform:operations:write.
 */

const ops = (extra: Record<string, string> = {}) => ({
  ...FAPI_HEADERS,
  authorization: 'Bearer demo-token:operations-analyst',
  'content-type': 'application/json',
  ...extra
})

const FAR = '2030-01-01T00:00:00.000Z'
const body = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ notification_type: 'planned_maintenance', title: 'Quarterly platform maintenance', scheduled_start: FAR, scheduled_end: '2030-01-01T04:00:00.000Z', ...extra })

function appWith() {
  const audit = new InMemoryHighClassAuditSink()
  return { app: createApp({ highClassAudit: audit }), audit }
}

type Wire = {
  id: string
  notification_type: string
  status: string
  notice_required_days: number
  notice_compliant: boolean
  dual_running_required: boolean
  notified_at: string | null
  acknowledged: boolean
  acknowledged_at: string | null
  nebras_ack_reference: string | null
  propagate_to_tpp: boolean
}

async function raise(app: ReturnType<typeof createApp>, key: string, extra: Record<string, unknown> = {}): Promise<Wire> {
  const res = await app.request('/back-office/scheme-notifications', { method: 'POST', headers: ops({ 'idempotency-key': key }), body: body(extra) })
  expect(res.status).toBe(201)
  return ((await res.json()) as { data: Wire }).data
}

describe('notice-clock pure logic (BACKOFFICE-78)', () => {
  it('30 days for breaking_change, 10 for the others', () => {
    expect(noticeRequiredDays('breaking_change')).toBe(30)
    expect(noticeRequiredDays('planned_maintenance')).toBe(10)
    expect(noticeRequiredDays('version_release')).toBe(10)
  })
  it('notice_deadline is scheduled_start minus the notice days', () => {
    const start = new Date('2026-07-31T00:00:00.000Z')
    expect(noticeDeadline(start, 10).toISOString()).toBe('2026-07-21T00:00:00.000Z')
    expect(noticeDeadline(start, 30).toISOString()).toBe('2026-07-01T00:00:00.000Z')
  })
})

describe('POST /back-office/scheme-notifications', () => {
  it('raises a notification (201): notice clock started, status notified, one audit', async () => {
    const { app, audit } = appWith()
    const rec = await raise(app, 'n1')
    expect(rec.status).toBe('notified')
    expect(rec.notice_required_days).toBe(10)
    expect(rec.dual_running_required).toBe(false)
    expect(rec.notice_compliant).toBe(true) // far-future start → compliant
    expect(rec.notified_at).not.toBeNull()
    expect(rec.propagate_to_tpp).toBe(true)
    expect(audit.events).toHaveLength(1)
    expect(audit.events[0]).toMatchObject({ event_type: 'scheme_notification_raised' })
  })

  it('a breaking_change requires 30-day notice + dual-running; a short-notice raise is non-compliant', async () => {
    const { app } = appWith()
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    const rec = await raise(app, 'n2', { notification_type: 'breaking_change', scheduled_start: soon, scheduled_end: soon })
    expect(rec.notice_required_days).toBe(30)
    expect(rec.dual_running_required).toBe(true)
    expect(rec.notice_compliant).toBe(false)
  })

  it('respects propagate_to_tpp=false', async () => {
    const { app } = appWith()
    const rec = await raise(app, 'n3', { propagate_to_tpp: false })
    expect(rec.propagate_to_tpp).toBe(false)
  })

  it('requires Idempotency-Key (400) and replays without a duplicate audit', async () => {
    const { app, audit } = appWith()
    expect((await app.request('/back-office/scheme-notifications', { method: 'POST', headers: ops(), body: body() })).status).toBe(400)
    const first = await app.request('/back-office/scheme-notifications', { method: 'POST', headers: ops({ 'idempotency-key': 'n4' }), body: body() })
    const second = await app.request('/back-office/scheme-notifications', { method: 'POST', headers: ops({ 'idempotency-key': 'n4' }), body: body() })
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(audit.events).toHaveLength(1)
  })

  it('validates the body (400): missing fields, invalid type, end before start', async () => {
    const { app } = appWith()
    expect((await app.request('/back-office/scheme-notifications', { method: 'POST', headers: ops({ 'idempotency-key': 'n5' }), body: JSON.stringify({ title: 'x' }) })).status).toBe(400)
    expect((await app.request('/back-office/scheme-notifications', { method: 'POST', headers: ops({ 'idempotency-key': 'n6' }), body: body({ notification_type: 'nope' }) })).status).toBe(400)
    expect((await app.request('/back-office/scheme-notifications', { method: 'POST', headers: ops({ 'idempotency-key': 'n7' }), body: body({ scheduled_end: '2029-01-01T00:00:00.000Z' }) })).status).toBe(400)
  })

  it('rejects a persona without platform:operations:write (403)', async () => {
    const { app } = appWith()
    const res = await app.request('/back-office/scheme-notifications', {
      method: 'POST',
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst', 'content-type': 'application/json', 'idempotency-key': 'n8' },
      body: body()
    })
    expect(res.status).toBe(403)
  })
})

describe('GET /back-office/scheme-notifications (platform:operations:read)', () => {
  it('lists with the {data,meta} envelope and filters by status + type', async () => {
    const { app } = appWith()
    await raise(app, 'l1')
    const res = await app.request('/back-office/scheme-notifications', { headers: ops() })
    expect(res.status).toBe(200)
    const list = (await res.json()) as { data: Wire[]; meta: { next_cursor: string | null } }
    expect(list.data.length).toBeGreaterThanOrEqual(1)
    expect(list.meta).toHaveProperty('next_cursor')

    const ackRes = await app.request('/back-office/scheme-notifications?status=acknowledged', { headers: ops() })
    expect(((await ackRes.json()) as { data: Wire[] }).data).toHaveLength(0)

    const typeRes = await app.request('/back-office/scheme-notifications?notification_type=planned_maintenance', { headers: ops() })
    expect(((await typeRes.json()) as { data: Wire[] }).data.length).toBeGreaterThanOrEqual(1)
  })

  it('rejects a persona without platform:operations:read (403)', async () => {
    const { app } = appWith()
    const res = await app.request('/back-office/scheme-notifications', { headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst' } })
    expect(res.status).toBe(403)
  })
})

describe('POST /back-office/scheme-notifications/{id}:acknowledge', () => {
  const ack = (app: ReturnType<typeof createApp>, id: string, payload: Record<string, unknown>, key: string) =>
    app.request(`/back-office/scheme-notifications/${id}:acknowledge`, { method: 'POST', headers: ops({ 'idempotency-key': key }), body: JSON.stringify(payload) })

  it('records Nebras acknowledgment (200): acknowledged, status acknowledged, one audit', async () => {
    const { app, audit } = appWith()
    const rec = await raise(app, 'a1')
    audit.events.length = 0
    const res = await ack(app, rec.id, { nebras_ack_reference: 'NBR-ACK-001' }, 'ack1')
    expect(res.status).toBe(200)
    const data = ((await res.json()) as { data: Wire }).data
    expect(data.acknowledged).toBe(true)
    expect(data.status).toBe('acknowledged')
    expect(data.nebras_ack_reference).toBe('NBR-ACK-001')
    expect(data.acknowledged_at).not.toBeNull()
    expect(audit.events).toHaveLength(1)
    expect(audit.events[0]).toMatchObject({ event_type: 'scheme_notification_acknowledged' })
  })

  it('404 unknown id and 400 without nebras_ack_reference', async () => {
    const { app } = appWith()
    const rec = await raise(app, 'a2')
    expect((await ack(app, '4d2c2e2a-0000-4000-8000-000000000000', { nebras_ack_reference: 'X' }, 'ack2')).status).toBe(404)
    expect((await ack(app, rec.id, {}, 'ack3')).status).toBe(400)
  })
})
