import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { itsmPriorityFor } from '../src/fraud-incidents/service.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-77 — Nebras fraud-incident reporting + scheme-imposed holds. Extends
 * the BACKOFFICE-22 fraud workflow with the "report to Nebras helpdesk" step:
 * maps Nebras P1–P4 severity to the ITSM (P3) priority scheme, raises a P3 ticket,
 * opens the customer operational-pause state, flags scheme-imposed holds (systemic
 * P1). GET is risk:read; POST + :resolve are risk:investigations:write. No PSU PII.
 */

class FakeItsm {
  tickets: Array<{ type: string; severity: string; team: string; summary: string }> = []
  async createTicket(input: { type: string; severity: string; team: string; summary: string }) {
    this.tickets.push(input)
    return { ticket_id: `tkt-${this.tickets.length}` }
  }
}

const risk = (extra: Record<string, string> = {}) => ({
  ...FAPI_HEADERS,
  authorization: 'Bearer demo-token:risk-analyst',
  'content-type': 'application/json',
  ...extra
})

const body = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ nebras_severity: 'P2', summary: 'Suspected coordinated fraud across several consents.', ...extra })

function appWith() {
  const audit = new InMemoryHighClassAuditSink()
  const itsm = new FakeItsm()
  return { app: createApp({ highClassAudit: audit, superadmin: { itsm } }), audit, itsm }
}

type Wire = {
  id: string
  nebras_severity: string
  itsm_priority: string
  status: string
  operational_pause: boolean
  scheme_imposed_hold: boolean
  resolved_at: string | null
  reported_at: string | null
}

async function report(app: ReturnType<typeof createApp>, key: string, extra: Record<string, unknown> = {}): Promise<Wire> {
  const res = await app.request('/back-office/fraud-incidents', { method: 'POST', headers: risk({ 'idempotency-key': key }), body: body(extra) })
  expect(res.status).toBe(201)
  return ((await res.json()) as { data: Wire }).data
}

describe('Nebras severity → ITSM priority mapping (BACKOFFICE-77)', () => {
  it('maps P1→critical, P2→high, P3→medium, P4→low', () => {
    expect(itsmPriorityFor('P1')).toBe('critical')
    expect(itsmPriorityFor('P2')).toBe('high')
    expect(itsmPriorityFor('P3')).toBe('medium')
    expect(itsmPriorityFor('P4')).toBe('low')
  })
})

describe('POST /back-office/fraud-incidents', () => {
  it('reports an incident (201): maps priority, opens operational pause, raises one P3 ticket + one audit', async () => {
    const { app, audit, itsm } = appWith()
    const rec = await report(app, 'f1', { nebras_severity: 'P2' })
    expect(rec.status).toBe('reported')
    expect(rec.itsm_priority).toBe('high')
    expect(rec.operational_pause).toBe(true)
    expect(rec.scheme_imposed_hold).toBe(false)
    expect(itsm.tickets).toHaveLength(1)
    expect(itsm.tickets[0]).toMatchObject({ severity: 'high', team: 'risk' })
    expect(audit.events).toHaveLength(1)
    expect(audit.events[0]).toMatchObject({ event_type: 'fraud_incident_reported', target_consent_id: null })
  })

  it('flags a scheme-imposed hold for a systemic P1 incident', async () => {
    const { app } = appWith()
    const rec = await report(app, 'f2', { nebras_severity: 'P1', client_id: '4d2c2e2a-0000-4000-8000-000000000111' })
    expect(rec.itsm_priority).toBe('critical')
    expect(rec.scheme_imposed_hold).toBe(true)
  })

  it('respects operational_pause=false', async () => {
    const { app } = appWith()
    const rec = await report(app, 'f3', { operational_pause: false })
    expect(rec.operational_pause).toBe(false)
  })

  it('requires Idempotency-Key (400) and replays without a duplicate ticket/audit', async () => {
    const { app, audit, itsm } = appWith()
    expect((await app.request('/back-office/fraud-incidents', { method: 'POST', headers: risk(), body: body() })).status).toBe(400)
    const first = await app.request('/back-office/fraud-incidents', { method: 'POST', headers: risk({ 'idempotency-key': 'f4' }), body: body() })
    const second = await app.request('/back-office/fraud-incidents', { method: 'POST', headers: risk({ 'idempotency-key': 'f4' }), body: body() })
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(itsm.tickets).toHaveLength(1)
    expect(audit.events).toHaveLength(1)
  })

  it('validates the body (400): missing fields and invalid severity', async () => {
    const { app } = appWith()
    expect((await app.request('/back-office/fraud-incidents', { method: 'POST', headers: risk({ 'idempotency-key': 'f5' }), body: JSON.stringify({ nebras_severity: 'P2' }) })).status).toBe(400)
    expect((await app.request('/back-office/fraud-incidents', { method: 'POST', headers: risk({ 'idempotency-key': 'f6' }), body: body({ nebras_severity: 'P9' }) })).status).toBe(400)
  })

  it('rejects a persona without risk:investigations:write (403)', async () => {
    const { app } = appWith()
    const res = await app.request('/back-office/fraud-incidents', {
      method: 'POST',
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:compliance-officer', 'content-type': 'application/json', 'idempotency-key': 'f7' },
      body: body()
    })
    expect(res.status).toBe(403)
  })
})

describe('GET /back-office/fraud-incidents (risk:read)', () => {
  it('lists with the {data,meta} envelope and filters by status + severity', async () => {
    const { app } = appWith()
    await report(app, 'g1', { nebras_severity: 'P1' })
    const res = await app.request('/back-office/fraud-incidents', { headers: risk() })
    expect(res.status).toBe(200)
    const list = (await res.json()) as { data: Wire[]; meta: { next_cursor: string | null } }
    expect(list.data.length).toBeGreaterThanOrEqual(1)
    expect(list.meta).toHaveProperty('next_cursor')
    const filtered = await app.request('/back-office/fraud-incidents?status=resolved', { headers: risk() })
    expect(((await filtered.json()) as { data: Wire[] }).data).toHaveLength(0)
    const bySev = await app.request('/back-office/fraud-incidents?nebras_severity=P1', { headers: risk() })
    expect(((await bySev.json()) as { data: Wire[] }).data.length).toBeGreaterThanOrEqual(1)
  })

  it('rejects a persona without risk:read (403)', async () => {
    const { app } = appWith()
    const res = await app.request('/back-office/fraud-incidents', {
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst' }
    })
    expect(res.status).toBe(403)
  })
})

describe('POST /back-office/fraud-incidents/{id}:resolve', () => {
  const resolve = (app: ReturnType<typeof createApp>, id: string, payload: Record<string, unknown>, key: string) =>
    app.request(`/back-office/fraud-incidents/${id}:resolve`, { method: 'POST', headers: risk({ 'idempotency-key': key }), body: JSON.stringify(payload) })

  it('resolves the incident (200): status resolved, pause lifted, resolved_at set, one audit', async () => {
    const { app, audit } = appWith()
    const rec = await report(app, 'r1')
    audit.events.length = 0
    const res = await resolve(app, rec.id, { resolution_note: 'Confirmed false positive after review with the scheme.' }, 'rv1')
    expect(res.status).toBe(200)
    const data = ((await res.json()) as { data: Wire }).data
    expect(data.status).toBe('resolved')
    expect(data.operational_pause).toBe(false)
    expect(data.resolved_at).not.toBeNull()
    expect(audit.events).toHaveLength(1)
    expect(audit.events[0]).toMatchObject({ event_type: 'fraud_incident_resolved' })
  })

  it('404 for an unknown incident and 400 without a resolution_note', async () => {
    const { app } = appWith()
    const rec = await report(app, 'r2')
    expect((await resolve(app, '4d2c2e2a-0000-4000-8000-000000000000', { resolution_note: 'Resolving an incident that does not exist here.' }, 'rv2')).status).toBe(404)
    expect((await resolve(app, rec.id, {}, 'rv3')).status).toBe(400)
  })
})
