import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import {
  InMemoryReconciliationBreakStore,
  InMemoryReconciliationLogStore,
  ReconciliationService
} from '../src/reconciliation/service.js'
import { detectBreaks } from '../src/reconciliation/breaks.js'
import { DEFAULT_THRESHOLDS } from '../src/reconciliation/thresholds.js'
import type { ReconLineResult, ReconResult } from '../src/reconciliation/engine.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-02 — break detection with configurable thresholds. Fee variances
 * over threshold → fee breaks (Finance notified); consent drift → consent breaks
 * (Operations notified); each break carries all three source refs.
 */

const WINDOW = { start: '2026-07-14T00:00:00.000Z', end: '2026-07-15T00:00:00.000Z' }

const line = (over: Partial<ReconLineResult>): ReconLineResult => ({
  line_ref: 'L', line_type: 'payment_settlement', channel: 'internal_retail', client_id: null,
  classification: 'unmatched', expected_fee: { amount: 100, currency: 'AED' }, nebras_fee: { amount: 100, currency: 'AED' },
  variance: null, source_a_ref: 'A', source_b_ref: 'B', source_c_ref: null, reason: 'fee_variance', ...over
})
const resultOf = (lines: ReconLineResult[]): ReconResult => ({
  line_count_total: lines.length,
  line_count_matched: lines.filter((l) => l.classification === 'matched').length,
  line_count_unmatched: lines.filter((l) => l.classification === 'unmatched').length,
  line_count_disputed: lines.filter((l) => l.classification === 'disputed').length,
  lines
})

class FakeItsm {
  tickets: Array<{ team: string; summary: string }> = []
  async createTicket(input: { type: string; severity: string; team: string; summary: string }) {
    this.tickets.push({ team: input.team, summary: input.summary })
    return { ticket_id: `t-${this.tickets.length}` }
  }
}

describe('detectBreaks', () => {
  it('flags a fee variance over the default >1 fils threshold as a Finance break with all three source refs', () => {
    const breaks = detectBreaks(resultOf([line({ variance: { amount: 7, currency: 'AED' }, source_a_ref: 'N1', source_b_ref: 'P1' })]))
    expect(breaks).toHaveLength(1)
    expect(breaks[0]!.notify_team).toBe('finance')
    expect(breaks[0]!.variance_amount).toEqual({ amount: 7, currency: 'AED' })
    expect(breaks[0]!.source_a_ref).toBe('N1')
    expect(breaks[0]!.source_b_ref).toBe('P1')
  })

  it('does NOT flag a variance at or below threshold (configurable)', () => {
    const small = detectBreaks(resultOf([line({ variance: { amount: 1, currency: 'AED' } })])) // 1 is not > 1
    expect(small).toHaveLength(0)
    const raised = detectBreaks(resultOf([line({ variance: { amount: 7, currency: 'AED' } })]), [
      ...DEFAULT_THRESHOLDS.filter((t) => t.fee_class !== 'payment_settlement'),
      { fee_class: 'payment_settlement', threshold_value: 10, unit: 'aed' }
    ])
    expect(raised).toHaveLength(0) // 7 not > 10
  })

  it('treats a missing line (no computed variance) as a break by construction', () => {
    const breaks = detectBreaks(resultOf([line({ variance: null, reason: 'missing_nebras_line', source_a_ref: 'MISSING' })]))
    expect(breaks).toHaveLength(1)
    expect(breaks[0]!.notify_team).toBe('finance')
  })

  it('routes consent-record drift to Operations as a counted break', () => {
    const breaks = detectBreaks(resultOf([line({ line_type: 'consent_record', variance: null, reason: 'consent_drift' })]))
    expect(breaks).toHaveLength(1)
    expect(breaks[0]!.notify_team).toBe('operations')
    expect(breaks[0]!.variance_count).toBe(1)
    expect(breaks[0]!.variance_amount).toBeNull()
  })

  it('ignores matched and disputed lines', () => {
    const breaks = detectBreaks(resultOf([line({ classification: 'matched' }), line({ classification: 'disputed' })]))
    expect(breaks).toHaveLength(0)
  })
})

describe('reconciliation run → break detection + notification', () => {
  it('persists detected breaks, notifies Finance, audits, and is idempotent', async () => {
    const logStore = new InMemoryReconciliationLogStore()
    const breakStore = new InMemoryReconciliationBreakStore()
    const itsm = new FakeItsm()
    const audit = new InMemoryHighClassAuditSink()
    const service = new ReconciliationService({ store: logStore, breakStore, itsm, audit })

    const run = await service.runDaily('trace-1', { window: WINDOW })
    // default sim: 8 unmatched fee lines (5 variance + 3 missing) → 8 Finance breaks
    expect(run.breaks).toHaveLength(8)
    expect(await breakStore.countForRun(run.run.run_id)).toBe(8)
    expect(itsm.tickets.filter((t) => t.team === 'finance')).toHaveLength(1) // one batched Finance ticket
    const ev = audit.events.find((e) => e.event_type === 'reconciliation_breaks_detected')
    expect((ev?.request_body as { break_count: number; finance_breaks: number }).break_count).toBe(8)
    expect((ev?.request_body as { finance_breaks: number }).finance_breaks).toBe(8)

    // idempotent re-run: no second detection
    const replay = await service.runDaily('trace-2', { window: WINDOW })
    expect(replay.created).toBe(false)
    expect(replay.breaks).toHaveLength(0)
    expect(await breakStore.countForRun(run.run.run_id)).toBe(8)
  })
})

describe('GET /back-office/reconciliation/breaks', () => {
  const breakStore = new InMemoryReconciliationBreakStore()
  let app: ReturnType<typeof createApp>
  let runId: string

  beforeAll(async () => {
    const logStore = new InMemoryReconciliationLogStore()
    const service = new ReconciliationService({ store: logStore, breakStore, itsm: new FakeItsm(), audit: new InMemoryHighClassAuditSink() })
    const run = await service.runDaily('seed', { window: WINDOW })
    runId = run.run.run_id
    app = createApp({ reconciliationBreakStore: breakStore })
  })

  it('lists breaks with the wire schema + filters by run_id and line_type', async () => {
    const finance = { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst' }
    const res = await app.request(`/back-office/reconciliation/breaks?run_id=${runId}`, { headers: finance })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Array<{ status: string; line_type: string; source_a_ref: string; reopened_count: number }> }
    expect(body.data.length).toBe(8)
    expect(body.data.every((b) => b.status === 'flagged')).toBe(true)
    expect(body.data[0]!.reopened_count).toBe(0)
    const filtered = await app.request('/back-office/reconciliation/breaks?line_type=payment_settlement', { headers: finance })
    expect(((await filtered.json()) as { data: unknown[] }).data.length).toBe(8)
  })

  it('rejects a persona without reconciliation:read (403)', async () => {
    const res = await app.request('/back-office/reconciliation/breaks', {
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:customer-care-agent' }
    })
    expect(res.status).toBe(403)
  })
})
