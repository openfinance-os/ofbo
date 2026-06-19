import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import {
  InMemoryReconciliationBreakStore,
  InMemoryReconciliationLogStore,
  InMemoryReconciliationThresholdStore,
  ReconciliationService
} from '../src/reconciliation/service.js'
import { mintScopes, type Principal } from '../src/auth.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-12 — configurable break thresholds per fee class. GET (reconciliation:read)
 * returns the effective set; PUT (platform:operations:write) updates it, High-class
 * audits old/new, notifies Finance + Compliance, and takes effect NEXT run (never
 * retroactively). Idempotency-Key required on PUT.
 */

class FakeItsm {
  tickets: { type: string; team: string }[] = []
  async createTicket(input: { type: string; team: string }) {
    this.tickets.push({ type: input.type, team: input.team })
    return { ticket_id: `tk-${this.tickets.length}` }
  }
}

const ops = (extra: Record<string, string> = {}) => ({ ...FAPI_HEADERS, authorization: 'Bearer demo-token:operations-analyst', 'content-type': 'application/json', ...extra })
const finance = (extra: Record<string, string> = {}) => ({ ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst', 'content-type': 'application/json', ...extra })

function harness() {
  const audit = new InMemoryHighClassAuditSink()
  const itsm = new FakeItsm()
  const thresholdStore = new InMemoryReconciliationThresholdStore()
  const app = createApp({ reconciliationThresholdStore: thresholdStore, highClassAudit: audit, superadmin: { itsm } })
  return { app, audit, itsm, thresholdStore }
}

describe('reconciliation thresholds (BACKOFFICE-12)', () => {
  it('GET returns the effective threshold set (defaults) for reconciliation:read', async () => {
    const { app } = harness()
    const res = await app.request('/back-office/reconciliation/thresholds', { headers: finance() })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { fee_class: string; threshold_value: number; unit: string }[] }
    expect(body.data.length).toBe(6) // BACKOFFICE-68 added the dao_api_call default
    const nebras = body.data.find((t) => t.fee_class === 'nebras_fees')!
    expect(nebras.unit).toBe('aed')
    expect(nebras.threshold_value).toBe(1)
    const dao = body.data.find((t) => t.fee_class === 'dao_api_call')!
    expect(dao).toMatchObject({ threshold_value: 1, unit: 'aed' })
  })

  it('PUT updates a threshold, audits old/new, and notifies Finance + Compliance', async () => {
    const { app, audit, itsm } = harness()
    const res = await app.request('/back-office/reconciliation/thresholds', {
      method: 'PUT',
      headers: ops({ 'idempotency-key': 't1' }),
      body: JSON.stringify([{ fee_class: 'nebras_fees', threshold_value: 500, unit: 'aed' }])
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { fee_class: string; threshold_value: number }[] }
    expect(body.data.find((t) => t.fee_class === 'nebras_fees')!.threshold_value).toBe(500)

    const ev = audit.events.find((e) => e.event_type === 'reconciliation_thresholds_updated')
    expect(ev).toBeTruthy()
    const rb = ev!.request_body as { old_values: { fee_class: string; threshold_value: number }[]; new_values: { fee_class: string; threshold_value: number }[]; effect: string }
    expect(rb.old_values.find((t) => t.fee_class === 'nebras_fees')!.threshold_value).toBe(1) // old
    expect(rb.new_values.find((t) => t.fee_class === 'nebras_fees')!.threshold_value).toBe(500) // new
    expect(rb.effect).toBe('next_run_only')
    expect(itsm.tickets.filter((t) => t.type === 'threshold_change').map((t) => t.team).sort()).toEqual(['compliance', 'finance'])
  })

  it('PUT replays the same Idempotency-Key verbatim (no second audit / tickets)', async () => {
    const { app, audit, itsm } = harness()
    const put = () => app.request('/back-office/reconciliation/thresholds', { method: 'PUT', headers: ops({ 'idempotency-key': 'k' }), body: JSON.stringify([{ fee_class: 'consent_record', threshold_value: 3, unit: 'count' }]) })
    await put()
    const audits = audit.events.length
    const tickets = itsm.tickets.length
    const replay = await put()
    expect(replay.status).toBe(200)
    expect(audit.events.length).toBe(audits) // cached — no re-execution
    expect(itsm.tickets.length).toBe(tickets)
  })

  it('enforces scope (403) and validates input (400)', async () => {
    const { app } = harness()
    // GET requires reconciliation:read — a customer-care-agent lacks it
    expect((await app.request('/back-office/reconciliation/thresholds', { headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:customer-care-agent' } })).status).toBe(403)
    // PUT requires platform:operations:write — finance-analyst (reconciliation:read) lacks it
    expect((await app.request('/back-office/reconciliation/thresholds', { method: 'PUT', headers: finance({ 'idempotency-key': 'x1' }), body: JSON.stringify([{ fee_class: 'nebras_fees', threshold_value: 5, unit: 'aed' }]) })).status).toBe(403)
    // 400 missing Idempotency-Key
    expect((await app.request('/back-office/reconciliation/thresholds', { method: 'PUT', headers: ops(), body: JSON.stringify([{ fee_class: 'nebras_fees', threshold_value: 5, unit: 'aed' }]) })).status).toBe(400)
    // 400 unknown fee_class
    expect((await app.request('/back-office/reconciliation/thresholds', { method: 'PUT', headers: ops({ 'idempotency-key': 'x2' }), body: JSON.stringify([{ fee_class: 'made_up', threshold_value: 5, unit: 'aed' }]) })).status).toBe(400)
    // 400 negative value
    expect((await app.request('/back-office/reconciliation/thresholds', { method: 'PUT', headers: ops({ 'idempotency-key': 'x3' }), body: JSON.stringify([{ fee_class: 'nebras_fees', threshold_value: -1, unit: 'aed' }]) })).status).toBe(400)
    // 400 bad unit
    expect((await app.request('/back-office/reconciliation/thresholds', { method: 'PUT', headers: ops({ 'idempotency-key': 'x4' }), body: JSON.stringify([{ fee_class: 'nebras_fees', threshold_value: 5, unit: 'usd' }]) })).status).toBe(400)
  })

  it('thresholds drive detection (same data, raised → strictly fewer variance breaks)', async () => {
    const WINDOW = { start: '2026-04-01T00:00:00.000Z', end: '2026-04-02T00:00:00.000Z' }
    const HUGE: { fee_class: 'nebras_fees' | 'payment_settlement' | 'tpp_aas_pass_through' | 'lfi_access_log' | 'consent_record'; threshold_value: number; unit: 'aed' | 'count' }[] = [
      { fee_class: 'nebras_fees', threshold_value: 9_999_999_999, unit: 'aed' },
      { fee_class: 'payment_settlement', threshold_value: 9_999_999_999, unit: 'aed' },
      { fee_class: 'tpp_aas_pass_through', threshold_value: 9_999_999_999, unit: 'aed' },
      { fee_class: 'lfi_access_log', threshold_value: 9_999_999_999, unit: 'aed' },
      { fee_class: 'consent_record', threshold_value: 9_999_999_999, unit: 'count' }
    ]
    // Default thresholds.
    const def = new ReconciliationService({ store: new InMemoryReconciliationLogStore(), breakStore: new InMemoryReconciliationBreakStore(), audit: new InMemoryHighClassAuditSink() })
    const defRun = await def.runDaily('d', { window: WINDOW })
    expect(defRun.breaks.length).toBeGreaterThan(0)

    // Same window + data, raised thresholds → strictly fewer breaks survive.
    const raisedStore = new InMemoryReconciliationThresholdStore()
    await raisedStore.replaceAll(HUGE, 'seed', 't')
    const raised = new ReconciliationService({ store: new InMemoryReconciliationLogStore(), breakStore: new InMemoryReconciliationBreakStore(), thresholdStore: raisedStore, audit: new InMemoryHighClassAuditSink() })
    const raisedRun = await raised.runDaily('r', { window: WINDOW })
    expect(raisedRun.breaks.length).toBeLessThan(defRun.breaks.length)
  })

  it('edits take effect next run and are never retroactive (a prior run is unchanged)', async () => {
    const breakStore = new InMemoryReconciliationBreakStore()
    const thresholdStore = new InMemoryReconciliationThresholdStore()
    const service = new ReconciliationService({ store: new InMemoryReconciliationLogStore(), breakStore, thresholdStore, audit: new InMemoryHighClassAuditSink() })
    const opsPrincipal: Principal = { subject: 'demo:operations-analyst', persona: 'operations-analyst', scopes: mintScopes('operations-analyst') }
    const WINDOW = { start: '2026-04-01T00:00:00.000Z', end: '2026-04-02T00:00:00.000Z' }

    const first = await service.runDaily('x', { window: WINDOW })
    expect(first.breaks.length).toBeGreaterThan(0)

    // Raise thresholds AFTER the run. The already-computed run is immutable.
    await service.updateThresholds(opsPrincipal, [{ fee_class: 'nebras_fees', threshold_value: 9_999_999_999, unit: 'aed' }], 'upd')
    const reRun = await service.runDaily('x', { window: WINDOW }) // same run_id → idempotent no-op
    expect(reRun.created).toBe(false)
    expect(await breakStore.countForRun(first.run.run_id)).toBe(first.breaks.length) // not retroactive
  })
})
