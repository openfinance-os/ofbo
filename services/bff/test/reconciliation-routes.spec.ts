import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { InMemoryReconciliationLogStore, ReconciliationService } from '../src/reconciliation/service.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-01 — reconciliation run read surface. reconciliation:read at the
 * BFF middleware AND the service. The runs are produced by the headless engine;
 * here we seed one via the service into a shared store, then read it back.
 */

const finance = { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst' }
const RUN_ID = 'recon-2026-07-14-daily'

const store = new InMemoryReconciliationLogStore()
let app: ReturnType<typeof createApp>

beforeAll(async () => {
  const service = new ReconciliationService({ store, audit: new InMemoryHighClassAuditSink() })
  await service.runDaily('trace-seed', { window: { start: '2026-07-14T00:00:00.000Z', end: '2026-07-15T00:00:00.000Z' } })
  app = createApp({ reconciliationLogStore: store })
})

describe('GET /back-office/reconciliation/runs', () => {
  it('lists runs with the wire schema + {data, meta} envelope', async () => {
    const res = await app.request('/back-office/reconciliation/runs', { headers: finance })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Array<{ run_id: string; status: string; reconciliation_window_start: string; line_count_matched: number }>; meta: { request_id: string } }
    expect(body.meta.request_id).toBeTruthy()
    const run = body.data.find((r) => r.run_id === RUN_ID)!
    expect(run.status).toBe('completed')
    expect(run.reconciliation_window_start).toBe('2026-07-14T00:00:00.000Z') // window column renamed for the wire
    expect(run.line_count_matched).toBe(100)
  })

  it('filters by run_type and status', async () => {
    const res = await app.request('/back-office/reconciliation/runs?run_type=daily&status=completed', { headers: finance })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data.length).toBeGreaterThan(0)
    const none = await app.request('/back-office/reconciliation/runs?status=failed', { headers: finance })
    expect(((await none.json()) as { data: unknown[] }).data).toHaveLength(0)
  })
})

describe('GET /back-office/reconciliation/runs/{run_id}', () => {
  it('returns the run summary with line counts', async () => {
    const res = await app.request(`/back-office/reconciliation/runs/${RUN_ID}`, { headers: finance })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { run_id: string; line_count_total: number; line_count_unmatched: number; line_count_disputed: number } }
    expect(body.data.run_id).toBe(RUN_ID)
    expect(body.data.line_count_total).toBe(110)
    expect(body.data.line_count_unmatched).toBe(8)
    expect(body.data.line_count_disputed).toBe(2)
  })

  it('404 for an unknown run', async () => {
    const res = await app.request('/back-office/reconciliation/runs/recon-9999-01-01-daily', { headers: finance })
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BACKOFFICE.RUN_NOT_FOUND')
  })
})

describe('reconciliation:read scope', () => {
  it('rejects a persona without reconciliation:read (403) — Customer Care has no finance scope', async () => {
    const res = await app.request('/back-office/reconciliation/runs', {
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:customer-care-agent' }
    })
    expect(res.status).toBe(403)
  })
})
