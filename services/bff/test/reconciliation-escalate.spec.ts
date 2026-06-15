import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { InMemoryReconciliationBreakStore, InMemoryReconciliationLogStore, ReconciliationService } from '../src/reconciliation/service.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-05 — one-click Nebras dispute case from a break. Opens the case via
 * the P6 egress gateway, persists the Nebras case id, transitions the break to
 * escalated_nebras_dispute. finance:disputes:write.
 */

const WINDOW = { start: '2026-07-14T00:00:00.000Z', end: '2026-07-15T00:00:00.000Z' }

class FakeEgress {
  cases: Array<Record<string, unknown>> = []
  async createDisputeCase(payload: Record<string, unknown>) {
    this.cases.push(payload)
    return { nebras_case_id: `nebras-case-${this.cases.length}` }
  }
  async revokeConsent() {
    return { acknowledged_in_ms: 1 }
  }
  async dispatchRefund() {
    return { ipp_status: 'ACSP' as const }
  }
}
class FakeItsm {
  async createTicket() {
    return { ticket_id: 't' }
  }
}
const finance = (extra: Record<string, string> = {}) => ({ ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst', ...extra })

describe('POST /back-office/reconciliation/breaks/{break_id}/escalate-nebras', () => {
  const breakStore = new InMemoryReconciliationBreakStore()
  const audit = new InMemoryHighClassAuditSink()
  const egress = new FakeEgress()
  let app: ReturnType<typeof createApp>
  let ids: string[]

  beforeAll(async () => {
    const svc = new ReconciliationService({ store: new InMemoryReconciliationLogStore(), breakStore, itsm: new FakeItsm(), audit: new InMemoryHighClassAuditSink() })
    await svc.runDaily('seed', { window: WINDOW })
    app = createApp({ reconciliationBreakStore: breakStore, highClassAudit: audit, nebrasEgress: egress })
    ids = (await breakStore.list({})).rows.map((r) => r.id)
  })

  it('opens a Nebras case via P6, persists the case id + escalates the break, audits', async () => {
    const id = ids[0]!
    const res = await app.request(`/back-office/reconciliation/breaks/${id}/escalate-nebras`, { method: 'POST', headers: finance({ 'idempotency-key': 'e1' }) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { break_id: string; status: string; nebras_dispute_case_id: string } }
    expect(body.data.status).toBe('escalated_nebras_dispute')
    expect(body.data.nebras_dispute_case_id).toMatch(/^nebras-case-/)
    // the case was opened through P6 with an evidence bundle carrying the source refs
    expect(egress.cases.length).toBeGreaterThan(0)
    expect(egress.cases.some((c) => c.break_id === id && c.source_a_ref)).toBe(true)
    const stored = await breakStore.get(id)
    expect(stored?.status).toBe('escalated_nebras_dispute')
    expect(stored?.nebras_dispute_case_id).toBe(body.data.nebras_dispute_case_id)
    const ev = audit.events.find((e) => e.event_type === 'reconciliation_break_escalated_nebras')
    expect((ev?.request_body as { nebras_dispute_case_id: string }).nebras_dispute_case_id).toBe(body.data.nebras_dispute_case_id)
  })

  it('replays the Idempotency-Key (no duplicate Nebras case); a re-escalate with a new key is 409', async () => {
    const id = ids[0]!
    const casesBefore = egress.cases.length
    const replay = await app.request(`/back-office/reconciliation/breaks/${id}/escalate-nebras`, { method: 'POST', headers: finance({ 'idempotency-key': 'e1' }) })
    expect(replay.status).toBe(200)
    expect(egress.cases.length).toBe(casesBefore) // replayed, no second P6 case
    const again = await app.request(`/back-office/reconciliation/breaks/${id}/escalate-nebras`, { method: 'POST', headers: finance({ 'idempotency-key': 'e2' }) })
    expect(again.status).toBe(409) // already escalated (terminal)
  })

  it('404 unknown break; 400 without Idempotency-Key', async () => {
    expect((await app.request('/back-office/reconciliation/breaks/4d2c2e2a-0000-4000-8000-000000000000/escalate-nebras', { method: 'POST', headers: finance({ 'idempotency-key': 'e3' }) })).status).toBe(404)
    expect((await app.request(`/back-office/reconciliation/breaks/${ids[1]}/escalate-nebras`, { method: 'POST', headers: finance() })).status).toBe(400)
  })

  it('rejects a persona without finance:disputes:write (403)', async () => {
    const res = await app.request(`/back-office/reconciliation/breaks/${ids[1]}/escalate-nebras`, {
      method: 'POST',
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:customer-care-agent', 'idempotency-key': 'e4' }
    })
    expect(res.status).toBe(403)
  })
})
