import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { InMemoryReconciliationBreakStore, InMemoryReconciliationLogStore } from '../src/reconciliation/service.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-10 — reconciliation replay over a date range from buffered source
 * data (for missed/failed runs). 202 + ReconciliationRun; platform:operations:write;
 * idempotent on the window (a repeat replay of an unchanged window is a no-op); the
 * human initiator is High-class audited. Idempotency-Key required (24h replay).
 */

const WINDOW = { window_start: '2026-05-01T00:00:00.000Z', window_end: '2026-05-02T00:00:00.000Z' }
const ops = (extra: Record<string, string> = {}) => ({
  ...FAPI_HEADERS,
  authorization: 'Bearer demo-token:operations-analyst',
  'content-type': 'application/json',
  ...extra
})

function harness() {
  const logStore = new InMemoryReconciliationLogStore()
  const breakStore = new InMemoryReconciliationBreakStore()
  const audit = new InMemoryHighClassAuditSink()
  const app = createApp({ reconciliationLogStore: logStore, reconciliationBreakStore: breakStore, highClassAudit: audit })
  return { logStore, breakStore, audit, app }
}

describe('POST /back-office/reconciliation/runs:replay', () => {
  it('triggers a replay run (202 + ReconciliationRun, run_type=replay) and High-class audits the initiator', async () => {
    const { app, audit } = harness()
    const res = await app.request('/back-office/reconciliation/runs:replay', { method: 'POST', headers: ops({ 'idempotency-key': 'r1' }), body: JSON.stringify(WINDOW) })
    expect(res.status).toBe(202)
    const body = (await res.json()) as { data: { run_id: string; run_type: string; status: string; reconciliation_window_start: string; reconciliation_window_end: string } }
    expect(body.data.run_type).toBe('replay')
    expect(body.data.run_id).toMatch(/^recon-replay-2026-05-01_2026-05-02$/)
    expect(body.data.status).toBe('completed')
    expect(body.data.reconciliation_window_start).toBe(WINDOW.window_start)

    const ev = audit.events.find((e) => e.event_type === 'reconciliation_replay_requested')
    expect(ev).toBeTruthy()
    expect(ev!.acting_persona).toBe('operations-analyst')
    expect(ev!.acting_principal).not.toMatch(/^system:/) // the human initiator, not the engine
    expect((ev!.request_body as { run_id: string }).run_id).toBe('recon-replay-2026-05-01_2026-05-02')
  })

  it('is idempotent on the window: a second replay (new key) returns the same run, created once', async () => {
    const { app, logStore } = harness()
    const first = await app.request('/back-office/reconciliation/runs:replay', { method: 'POST', headers: ops({ 'idempotency-key': 'a' }), body: JSON.stringify(WINDOW) })
    const second = await app.request('/back-office/reconciliation/runs:replay', { method: 'POST', headers: ops({ 'idempotency-key': 'b' }), body: JSON.stringify(WINDOW) })
    expect(first.status).toBe(202)
    expect(second.status).toBe(202)
    const a = (await first.json()) as { data: { run_id: string } }
    const b = (await second.json()) as { data: { run_id: string } }
    expect(b.data.run_id).toBe(a.data.run_id)
    // exactly one replay run persisted — the second is an idempotent no-op
    const { rows } = await logStore.list({ run_type: 'replay' })
    expect(rows.filter((r) => r.run_id === a.data.run_id)).toHaveLength(1)
  })

  it('replays the same Idempotency-Key verbatim (no re-execution)', async () => {
    const { app, audit } = harness()
    await app.request('/back-office/reconciliation/runs:replay', { method: 'POST', headers: ops({ 'idempotency-key': 'k1' }), body: JSON.stringify(WINDOW) })
    const before = audit.events.length
    const replay = await app.request('/back-office/reconciliation/runs:replay', { method: 'POST', headers: ops({ 'idempotency-key': 'k1' }), body: JSON.stringify(WINDOW) })
    expect(replay.status).toBe(202)
    expect(audit.events.length).toBe(before) // cached — no second execution, no second audit
  })

  it('enforces platform:operations:write (403 for a finance-analyst), Idempotency-Key (400), and a valid window (400)', async () => {
    const { app } = harness()
    // 403 — finance-analyst lacks platform:operations:write (double-enforced at BFF + service)
    const denied = await app.request('/back-office/reconciliation/runs:replay', {
      method: 'POST',
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst', 'content-type': 'application/json', 'idempotency-key': 'd1' },
      body: JSON.stringify(WINDOW)
    })
    expect(denied.status).toBe(403)
    // 400 — missing Idempotency-Key
    expect((await app.request('/back-office/reconciliation/runs:replay', { method: 'POST', headers: ops(), body: JSON.stringify(WINDOW) })).status).toBe(400)
    // 400 — window_end not after window_start
    expect(
      (await app.request('/back-office/reconciliation/runs:replay', { method: 'POST', headers: ops({ 'idempotency-key': 'w1' }), body: JSON.stringify({ window_start: '2026-05-02T00:00:00.000Z', window_end: '2026-05-01T00:00:00.000Z' }) })).status
    ).toBe(400)
  })
})
