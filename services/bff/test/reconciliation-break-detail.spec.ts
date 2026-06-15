import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { InMemoryReconciliationBreakStore, InMemoryReconciliationLogStore, ReconciliationService } from '../src/reconciliation/service.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-11 — three-source side-by-side diff view per break. GET returns the
 * full ReconciliationBreak: Nebras (source_a) / platform (source_b) / fintech
 * (source_c) refs + the variance to highlight. reconciliation:read.
 */

const WINDOW = { start: '2026-07-14T00:00:00.000Z', end: '2026-07-15T00:00:00.000Z' }
const finance = { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst' }

describe('GET /back-office/reconciliation/breaks/{break_id}', () => {
  const breakStore = new InMemoryReconciliationBreakStore()
  let app: ReturnType<typeof createApp>
  let breakId: string

  beforeAll(async () => {
    const svc = new ReconciliationService({ store: new InMemoryReconciliationLogStore(), breakStore, audit: new InMemoryHighClassAuditSink() })
    await svc.runDaily('seed', { window: WINDOW })
    app = createApp({ reconciliationBreakStore: breakStore })
    // a fee-variance break carries a variance + all three source markers
    const rows = (await breakStore.list({ line_type: 'payment_settlement' })).rows
    breakId = rows.find((r) => r.variance_amount !== null)?.id ?? rows[0]!.id
  })

  it('returns the break with the three source refs + variance for the diff view', async () => {
    const res = await app.request(`/back-office/reconciliation/breaks/${breakId}`, { headers: finance })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { id: string; status: string; source_a_ref: string; source_b_ref: string; source_c_ref: string | null; variance_amount: { amount: number; currency: string } | null; line_type: string }
    }
    expect(body.data.id).toBe(breakId)
    expect(body.data.source_a_ref).toBeTruthy() // Nebras line
    expect(body.data.source_b_ref).toBeTruthy() // platform log line
    expect(body.data.line_type).toBe('payment_settlement')
    // a fee-variance break highlights the money delta
    expect(body.data.variance_amount).toEqual({ amount: 7, currency: 'AED' })
  })

  it('404 for an unknown break', async () => {
    const res = await app.request('/back-office/reconciliation/breaks/4d2c2e2a-0000-4000-8000-000000000000', { headers: finance })
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BACKOFFICE.BREAK_NOT_FOUND')
  })

  it('rejects a persona without reconciliation:read (403)', async () => {
    const res = await app.request(`/back-office/reconciliation/breaks/${breakId}`, {
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:customer-care-agent' }
    })
    expect(res.status).toBe(403)
  })
})
