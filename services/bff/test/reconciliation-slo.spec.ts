import { describe, expect, it } from 'vitest'
import type { StoredReconciliationBreak, StoredReconciliationRun } from '@ofbo/db'
import { createApp } from '../src/app.js'
import { ReconciliationSloService, percentile, ageBucket } from '../src/analytics/reconciliation-slo.js'
import { ScopeDeniedError } from '../src/rbac.js'
import type { Principal } from '../src/auth.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-09 — Reconciliation Console SLO dashboard. Read-only AnalyticsView
 * (reconciliation:read): open breaks by age, p50/p90 resolution time (30-day rolling),
 * dispute pipeline, last/next run, pass rate.
 */

const NOW = new Date('2026-06-15T12:00:00.000Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString()
const daysAgo = (d: number) => hoursAgo(d * 24)

const mkBreak = (over: Partial<StoredReconciliationBreak>): StoredReconciliationBreak => ({
  id: crypto.randomUUID(),
  run_id: 'recon-2026-06-15-1',
  client_id: null,
  channel: 'internal_retail',
  line_type: 'nebras_fees',
  status: 'flagged',
  variance_amount: null,
  variance_count: null,
  source_a_ref: 'a',
  source_b_ref: 'b',
  source_c_ref: null,
  assigned_to: null,
  sla_clock_started_at: null,
  resolution_outcome: null,
  resolution_note: null,
  nebras_dispute_case_id: null,
  reopened_count: 0,
  resolved_at: null,
  created_at: daysAgo(1),
  ...over
})

const mkRun = (over: Partial<StoredReconciliationRun>): StoredReconciliationRun => ({
  id: crypto.randomUUID(),
  run_id: 'recon-2026-06-15-1',
  run_type: 'daily',
  status: 'completed',
  window_start: daysAgo(1),
  window_end: NOW.toISOString(),
  line_count_total: 100,
  line_count_matched: 95,
  line_count_unmatched: 5,
  line_count_disputed: 0,
  failure_reason: null,
  created_at: NOW.toISOString(),
  ...over
})

const svc = (breaks: StoredReconciliationBreak[], runs: StoredReconciliationRun[]) =>
  new ReconciliationSloService({
    breaks: { listForRange: async () => breaks },
    runs: { list: async () => ({ rows: runs, next_cursor: null }) },
    now: () => NOW
  })

const reconRead: Principal = { subject: 'svc:test', persona: 'finance-analyst', scopes: ['reconciliation:read'] }
const wrong: Principal = { subject: 'svc:test', persona: 'customer-care-agent', scopes: ['consents:admin'] }

describe('SLO pure helpers (BACKOFFICE-09)', () => {
  it('percentile interpolates and handles small samples', () => {
    expect(percentile([], 50)).toBeNull()
    expect(percentile([10], 90)).toBe(10)
    expect(percentile([10, 20], 50)).toBe(15)
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5)
  })
  it('ageBucket maps ms to the four buckets', () => {
    const H = 60 * 60 * 1000
    expect(ageBucket(12 * H)).toBe('under_1d')
    expect(ageBucket(48 * H)).toBe('1_to_3d')
    expect(ageBucket(5 * 24 * H)).toBe('3_to_7d')
    expect(ageBucket(10 * 24 * H)).toBe('over_7d')
  })
})

describe('ReconciliationSloService.view', () => {
  it('aggregates open breaks by age, 30-day resolution percentiles, dispute pipeline, run + pass rate', async () => {
    const breaks: StoredReconciliationBreak[] = [
      mkBreak({ status: 'flagged', created_at: hoursAgo(12) }), // under_1d
      mkBreak({ status: 'assigned', created_at: daysAgo(2) }), // 1_to_3d
      mkBreak({ status: 'flagged', created_at: daysAgo(5) }), // 3_to_7d
      mkBreak({ status: 'assigned', created_at: daysAgo(10) }), // over_7d
      // resolved within 30d: created 14th 12:00, resolved 15th 00:00 → 12h
      mkBreak({ status: 'resolved_matched', resolution_outcome: 'resolved_matched', created_at: hoursAgo(24), resolved_at: hoursAgo(12) }),
      // resolved but OUTSIDE the 30-day rolling window → excluded
      mkBreak({ status: 'resolved_matched', resolution_outcome: 'resolved_matched', created_at: daysAgo(45), resolved_at: daysAgo(40) }),
      mkBreak({ status: 'escalated_nebras_dispute', created_at: daysAgo(3) }),
      mkBreak({ status: 'escalated_fintech_billing', created_at: daysAgo(3) })
    ]
    const { data, freshness } = await svc(breaks, [mkRun({})]).view(reconRead)

    const open = data.open_breaks as { total: number; by_age_bucket: Record<string, number> }
    expect(open.total).toBe(4)
    expect(open.by_age_bucket).toEqual({ under_1d: 1, '1_to_3d': 1, '3_to_7d': 1, over_7d: 1 })

    const res = data.resolution_time_30d as { sample_size: number; p50_hours: number; p90_hours: number }
    expect(res.sample_size).toBe(1)
    expect(res.p50_hours).toBe(12)

    expect(data.dispute_pipeline).toEqual({ open_nebras_disputes: 1, open_fintech_billing_escalations: 1 })

    const last = data.last_run as { pass_rate_pct: number; line_count_total: number }
    expect(last.pass_rate_pct).toBe(95)
    expect(data.pass_rate_30d_pct).toBe(95)
    expect(data.next_run_estimated_at).toBe('2026-06-16T12:00:00.000Z')

    expect(freshness.stale).toBe(false)
    expect(freshness.view_refreshed_at).toBe('2026-06-15T12:00:00.000Z')
  })

  it('handles an empty dataset (no runs, no breaks)', async () => {
    const { data } = await svc([], []).view(reconRead)
    expect((data.open_breaks as { total: number }).total).toBe(0)
    expect((data.resolution_time_30d as { sample_size: number; p50_hours: number | null }).p50_hours).toBeNull()
    expect(data.last_run).toBeNull()
    expect(data.next_run_estimated_at).toBeNull()
    expect(data.pass_rate_30d_pct).toBeNull()
  })

  it('rejects a principal without reconciliation:read', async () => {
    await expect(svc([], []).view(wrong)).rejects.toBeInstanceOf(ScopeDeniedError)
  })
})

describe('GET /back-office/analytics/reconciliation-slo', () => {
  it('returns 200 with the AnalyticsView envelope (data + meta + freshness) for reconciliation:read', async () => {
    const app = createApp()
    const res = await app.request('/back-office/analytics/reconciliation-slo', {
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst' }
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Record<string, unknown>; meta: { request_id: string }; freshness: { stale: boolean } }
    expect(body.meta.request_id).toBeTruthy()
    expect(body.data).toHaveProperty('open_breaks')
    expect(body.data).toHaveProperty('resolution_time_30d')
    expect(body.freshness).toHaveProperty('stale')
  })

  it('rejects a persona without reconciliation:read at the middleware (403)', async () => {
    const app = createApp()
    const res = await app.request('/back-office/analytics/reconciliation-slo', {
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:customer-care-agent' }
    })
    expect(res.status).toBe(403)
  })
})
