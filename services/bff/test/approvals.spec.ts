import { describe, expect, it } from 'vitest'
import { getAdapter } from '@ofbo/ports'
import { InMemoryAuthAuditSink } from '../src/auth.js'
import { mintScopes } from '../src/auth.js'
import { ApprovalsService, InMemoryApprovalStore } from '../src/approvals/service.js'
import { addBusinessHours } from '../src/business-hours.js'
import { createApp } from '../src/app.js'
import { FAPI_HEADERS } from './helpers.js'

const idp = getAdapter('p2-identity-provider', 'demo')
const asPersona = (p: string) => ({
  ...FAPI_HEADERS,
  'content-type': 'application/json',
  'idempotency-key': crypto.randomUUID(),
  authorization: `Bearer demo-token:${p}`
})

function build(nowRef?: { now: Date }) {
  const audit = new InMemoryAuthAuditSink()
  const executed: unknown[] = []
  const app = createApp({
    idp,
    audit,
    approvals: {
      now: nowRef ? () => nowRef.now : undefined,
      operations: {
        demo_echo: {
          initiatorScope: 'finance:reconciliation:write',
          approverScope: 'platform:operations:write',
          execute: async (payload) => {
            executed.push(payload)
            return { echoed: payload }
          }
        }
      }
    }
  })
  return { app, audit, executed }
}

async function createApproval(app: ReturnType<typeof build>['app'], persona = 'finance-analyst') {
  const res = await app.request('/approvals', {
    method: 'POST',
    headers: asPersona(persona),
    body: JSON.stringify({ operation_type: 'demo_echo', operation_payload: { note: 'gated' } })
  })
  return res
}

describe('BACKOFFICE-44 — four-eyes approval primitive', () => {
  it('creates a pending approval (201) with a 2-business-hour expiry', async () => {
    const { app } = build()
    const res = await createApproval(app)
    expect(res.status).toBe(201)
    const { data } = (await res.json()) as { data: Record<string, string> }
    expect(data.state).toBe('pending')
    expect(data.operation_type).toBe('demo_echo')
    expect(data.approver_required_scope).toBe('platform:operations:write')
    expect(data.approval_request_id).toBeTruthy()
    const expiry = new Date(data.expires_at!).getTime()
    const expected = addBusinessHours(new Date(), 2).getTime()
    expect(Math.abs(expiry - expected)).toBeLessThan(120_000)
  })

  it('rejects an unregistered operation type (400)', async () => {
    const { app } = build()
    const res = await app.request('/approvals', {
      method: 'POST',
      headers: asPersona('finance-analyst'),
      body: JSON.stringify({ operation_type: 'not-a-gated-op', operation_payload: {} })
    })
    expect(res.status).toBe(400)
  })

  it('lists pending approvals only for holders of the approver scope', async () => {
    const { app } = build()
    await createApproval(app)
    const ops = await app.request('/approvals/pending', { headers: asPersona('operations-analyst') })
    const opsBody = (await ops.json()) as { data: unknown[] }
    expect(ops.status).toBe(200)
    expect(opsBody.data.length).toBe(1)
    const care = await app.request('/approvals/pending', { headers: asPersona('customer-care-agent') })
    const careBody = (await care.json()) as { data: unknown[] }
    expect(careBody.data.length).toBe(0)
  })

  it('rejects self-approval with 409 — even for the super admin', async () => {
    const { app } = build()
    const created = await createApproval(app, 'platform-super-admin')
    const { data } = (await created.json()) as { data: { approval_request_id: string } }
    const res = await app.request(`/approvals/${data.approval_request_id}:approve`, {
      method: 'POST',
      headers: asPersona('platform-super-admin')
    })
    expect(res.status).toBe(409)
  })

  it('rejects approval by a principal without the approver scope (403)', async () => {
    const { app } = build()
    const created = await createApproval(app)
    const { data } = (await created.json()) as { data: { approval_request_id: string } }
    const res = await app.request(`/approvals/${data.approval_request_id}:approve`, {
      method: 'POST',
      headers: asPersona('customer-care-agent')
    })
    expect(res.status).toBe(403)
  })

  it('a second authorised principal approves: 200, executes the gated operation, audited', async () => {
    const { app, audit, executed } = build()
    const created = await createApproval(app, 'finance-analyst')
    const { data } = (await created.json()) as { data: { approval_request_id: string } }
    const res = await app.request(`/approvals/${data.approval_request_id}:approve`, {
      method: 'POST',
      headers: asPersona('operations-analyst')
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Record<string, unknown> }
    expect(body.data.state).toBe('approved')
    expect(body.data.approver).toContain('operations-analyst')
    expect(body.data.execution_result).toEqual({ echoed: { note: 'gated' } })
    expect(executed).toHaveLength(1)
    const types = audit.events.map((e) => e.event_type)
    expect(types).toContain('approval_requested')
    expect(types).toContain('approval_approved')
  })

  it('rejection requires a reason of ≥10 chars and never executes', async () => {
    const { app, executed } = build()
    const created = await createApproval(app)
    const { data } = (await created.json()) as { data: { approval_request_id: string } }
    const short = await app.request(`/approvals/${data.approval_request_id}:reject`, {
      method: 'POST',
      headers: asPersona('operations-analyst'),
      body: JSON.stringify({ reject_reason: 'too short' })
    })
    expect(short.status).toBe(400)
    const ok = await app.request(`/approvals/${data.approval_request_id}:reject`, {
      method: 'POST',
      headers: asPersona('operations-analyst'),
      body: JSON.stringify({ reject_reason: 'variance exceeds policy threshold' })
    })
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { data: Record<string, unknown> }
    expect(body.data.state).toBe('rejected')
    expect(executed).toHaveLength(0)
  })

  it('an expired request times out: approve → 409, state reads timed_out', async () => {
    const nowRef = { now: new Date('2026-06-10T08:00:00Z') } // a Wednesday
    const { app } = build(nowRef)
    const created = await createApproval(app)
    const { data } = (await created.json()) as { data: { approval_request_id: string } }
    nowRef.now = new Date('2026-06-10T11:00:01Z') // > 2 business hours later
    const res = await app.request(`/approvals/${data.approval_request_id}:approve`, {
      method: 'POST',
      headers: asPersona('operations-analyst')
    })
    expect(res.status).toBe(409)
    const read = await app.request(`/approvals/${data.approval_request_id}`, {
      headers: asPersona('operations-analyst')
    })
    const body = (await read.json()) as { data: Record<string, unknown> }
    expect(body.data.state).toBe('timed_out')
  })
})

describe('BACKOFFICE-44 — review-driven hardening', () => {
  it("enforces the spec's '(initiator scope)': a persona without it cannot initiate (403)", async () => {
    const { app } = build()
    const res = await createApproval(app, 'customer-care-agent') // Care holds no finance scope
    expect(res.status).toBe(403)
  })

  it("enforces '(initiator or approver scope)' on reads: a non-party persona gets 403", async () => {
    const { app } = build()
    const created = await createApproval(app, 'finance-analyst')
    const { data } = (await created.json()) as { data: { approval_request_id: string } }
    const outsider = await app.request(`/approvals/${data.approval_request_id}`, { headers: asPersona('customer-care-agent') })
    expect(outsider.status).toBe(403)
    const initiator = await app.request(`/approvals/${data.approval_request_id}`, { headers: asPersona('finance-analyst') })
    expect(initiator.status).toBe(200)
  })

  it('requires Idempotency-Key on mutating routes (400 when missing)', async () => {
    const { app } = build()
    const headers: Record<string, string> = { ...asPersona('finance-analyst') }
    delete headers['idempotency-key']
    const res = await app.request('/approvals', {
      method: 'POST',
      headers,
      body: JSON.stringify({ operation_type: 'demo_echo', operation_payload: {} })
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('BACKOFFICE.MISSING_IDEMPOTENCY_KEY')
  })

  it('replays an Idempotency-Key: same approval, no duplicate created', async () => {
    const { app } = build()
    const headers = asPersona('finance-analyst')
    const payload = { method: 'POST', headers, body: JSON.stringify({ operation_type: 'demo_echo', operation_payload: { n: 1 } }) }
    const first = (await (await app.request('/approvals', payload)).json()) as { data: { approval_request_id: string } }
    const replay = (await (await app.request('/approvals', payload)).json()) as { data: { approval_request_id: string } }
    expect(replay.data.approval_request_id).toBe(first.data.approval_request_id)
    const list = await app.request('/approvals/pending', { headers: asPersona('operations-analyst') })
    expect(((await list.json()) as { data: unknown[] }).data).toHaveLength(1)
  })

  it('paginates the pending list with limit + next_cursor (cursor-only, no offset)', async () => {
    const { app } = build()
    for (let i = 0; i < 3; i++) await createApproval(app, 'finance-analyst')
    const page1 = (await (
      await app.request('/approvals/pending?limit=2', { headers: asPersona('operations-analyst') })
    ).json()) as { data: { approval_request_id: string }[]; meta: { next_cursor: string | null } }
    expect(page1.data).toHaveLength(2)
    expect(page1.meta.next_cursor).toBeTruthy()
    const page2 = (await (
      await app.request(`/approvals/pending?limit=2&cursor=${page1.meta.next_cursor}`, { headers: asPersona('operations-analyst') })
    ).json()) as { data: unknown[]; meta: { next_cursor: string | null } }
    expect(page2.data).toHaveLength(1)
    expect(page2.meta.next_cursor).toBeNull()
  })

  it('refuses to approve a record whose operation lost its executor (409, no approval_approved audit)', async () => {
    const store = new InMemoryApprovalStore()
    const audit = new InMemoryAuthAuditSink()
    const op = { initiatorScope: 'finance:reconciliation:write', approverScope: 'platform:operations:write', execute: async () => ({}) }
    const withOp = new ApprovalsService(audit, { store, operations: { demo_echo: op } })
    const finance = { subject: 'demo:finance-analyst', persona: 'finance-analyst' as const, scopes: mintScopes('finance-analyst') }
    const ops = { subject: 'demo:operations-analyst', persona: 'operations-analyst' as const, scopes: mintScopes('operations-analyst') }
    const r = await withOp.requestApproval(finance, { operation_type: 'demo_echo', operation_payload: {} }, 't-1')
    // same store, registry no longer knows the operation (e.g. config drift across deploys)
    const withoutOp = new ApprovalsService(audit, { store, operations: {} })
    await expect(withoutOp.approve(ops, r.approval_request_id, 't-2')).rejects.toMatchObject({ status: 409, code: 'BACKOFFICE.OPERATION_UNREGISTERED' })
    expect(audit.events.map((e) => e.event_type)).not.toContain('approval_approved')
  })

  it('audits the timed_out transition', async () => {
    const nowRef = { now: new Date('2026-06-10T08:00:00Z') }
    const { app, audit } = build(nowRef)
    const created = await createApproval(app, 'finance-analyst')
    const { data } = (await created.json()) as { data: { approval_request_id: string } }
    nowRef.now = new Date('2026-06-10T11:00:01Z')
    await app.request(`/approvals/${data.approval_request_id}`, { headers: asPersona('finance-analyst') })
    expect(audit.events.map((e) => e.event_type)).toContain('approval_timed_out')
  })
})

describe('business-hours clock (adopting-bank default: clocks pause weekends)', () => {
  it('adds plain hours within a weekday', () => {
    const wed = new Date('2026-06-10T08:00:00Z')
    expect(addBusinessHours(wed, 2).toISOString()).toBe('2026-06-10T10:00:00.000Z')
  })
  it('spills over a weekend', () => {
    const friEvening = new Date('2026-06-12T23:30:00Z') // Friday
    const out = addBusinessHours(friEvening, 2)
    expect([1].includes(out.getUTCDay())).toBe(true) // lands on Monday
  })
})
