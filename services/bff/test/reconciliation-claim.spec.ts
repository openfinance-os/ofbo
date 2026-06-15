import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import {
  InMemoryReconciliationBreakStore,
  InMemoryReconciliationLogStore,
  ReconciliationService
} from '../src/reconciliation/service.js'
import type { Principal } from '../src/auth.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-03 — break investigation workflow (claim). Claiming a flagged break
 * → assigned, records the claimant, starts the SLA clock, removes it from other
 * queues. finance:reconciliation:write; consent-record breaks may also be claimed
 * with platform:operations:write.
 */

const WINDOW = { start: '2026-07-14T00:00:00.000Z', end: '2026-07-15T00:00:00.000Z' }
class FakeItsm {
  async createTicket() {
    return { ticket_id: 't' }
  }
}
const finance = (extra: Record<string, string> = {}) => ({ ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst', ...extra })

describe('POST /back-office/reconciliation/breaks/{break_id}/claim', () => {
  const breakStore = new InMemoryReconciliationBreakStore()
  const audit = new InMemoryHighClassAuditSink()
  let app: ReturnType<typeof createApp>
  let breakId: string

  beforeAll(async () => {
    const svc = new ReconciliationService({ store: new InMemoryReconciliationLogStore(), breakStore, itsm: new FakeItsm(), audit: new InMemoryHighClassAuditSink() })
    await svc.runDaily('seed', { window: WINDOW })
    app = createApp({ reconciliationBreakStore: breakStore, highClassAudit: audit })
    breakId = (await breakStore.list({})).rows[0]!.id
  })

  it('claims a flagged break → assigned, records claimant + SLA clock, audits', async () => {
    const res = await app.request(`/back-office/reconciliation/breaks/${breakId}/claim`, { method: 'POST', headers: finance({ 'idempotency-key': 'c1' }) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { status: string; assigned_to: string; sla_clock_started_at: string } }
    expect(body.data.status).toBe('assigned')
    expect(body.data.assigned_to).toBeTruthy()
    expect(body.data.sla_clock_started_at).toBeTruthy()
    const ev = audit.events.find((e) => e.event_type === 'reconciliation_break_claimed')
    expect((ev?.request_body as { break_id: string }).break_id).toBe(breakId)
    expect(ev?.scope_used).toBe('finance:reconciliation:write')
  })

  it('a second claim on the now-assigned break is rejected (409) — removed from other queues', async () => {
    const res = await app.request(`/back-office/reconciliation/breaks/${breakId}/claim`, { method: 'POST', headers: finance({ 'idempotency-key': 'c2' }) })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BACKOFFICE.BREAK_NOT_CLAIMABLE')
  })

  it('replays the original Idempotency-Key result (200, no re-claim)', async () => {
    const res = await app.request(`/back-office/reconciliation/breaks/${breakId}/claim`, { method: 'POST', headers: finance({ 'idempotency-key': 'c1' }) })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { data: { status: string } }).data.status).toBe('assigned')
  })

  it('404 for an unknown break; 400 without Idempotency-Key', async () => {
    const unknown = await app.request('/back-office/reconciliation/breaks/4d2c2e2a-0000-4000-8000-000000000000/claim', { method: 'POST', headers: finance({ 'idempotency-key': 'c3' }) })
    expect(unknown.status).toBe(404)
    const noKey = await app.request(`/back-office/reconciliation/breaks/${breakId}/claim`, { method: 'POST', headers: finance() })
    expect(noKey.status).toBe(400)
  })

  it('rejects a persona without finance:reconciliation:write (403)', async () => {
    const res = await app.request(`/back-office/reconciliation/breaks/${breakId}/claim`, {
      method: 'POST',
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:customer-care-agent', 'idempotency-key': 'c4' }
    })
    expect(res.status).toBe(403)
  })
})

describe('claim scope rule (service layer)', () => {
  const ops: Principal = { subject: 'demo:operations-analyst', persona: 'operations-analyst', scopes: ['platform:operations:write'] }
  const care: Principal = { subject: 'demo:customer-care-agent', persona: 'customer-care-agent', scopes: ['consents:admin'] }

  async function seedBreak(lineType: string) {
    const breakStore = new InMemoryReconciliationBreakStore()
    const svc = new ReconciliationService({ store: new InMemoryReconciliationLogStore(), breakStore, audit: new InMemoryHighClassAuditSink() })
    await breakStore.createMany([{ run_id: 'r1', line_type: lineType, variance_count: 1, source_a_ref: 'a', source_b_ref: 'b' }])
    const id = (await breakStore.list({})).rows[0]!.id
    return { svc, id }
  }

  it('a consent-record break may be claimed with platform:operations:write', async () => {
    const { svc, id } = await seedBreak('consent_record')
    const claimed = await svc.claimBreak(ops, id, 't')
    expect(claimed.status).toBe('assigned')
  })

  it('platform:operations:write cannot claim a FEE break (denied)', async () => {
    const { svc, id } = await seedBreak('payment_settlement')
    await expect(svc.claimBreak(ops, id, 't')).rejects.toThrow()
  })

  it('a persona with neither write scope is denied', async () => {
    const { svc, id } = await seedBreak('consent_record')
    await expect(svc.claimBreak(care, id, 't')).rejects.toThrow()
  })
})
