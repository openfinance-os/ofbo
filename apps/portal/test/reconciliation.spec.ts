import { describe, expect, it, vi } from 'vitest'
import { claimBreak, escalateToNebras, formatMoney, getBreak, listBreaks, listRuns, resolveBreak, ESCALATABLE_STATES, ReconApiError, RESOLVE_OUTCOMES } from '../src/lib/reconciliation.js'

/**
 * UI-03 — Reconciliation BFF client (BACKOFFICE-01/-02/-03/-04/-06). Asserts the
 * contract paths, Bearer + x-fapi-interaction-id propagation, the Idempotency-Key on
 * every mutation, and the {data}/{error} envelope (+ meta.next_cursor) unwrap. fetch faked.
 */

const BASE = 'http://bff.test'
const TOKEN = 'demo-token:finance-analyst'
const R = '/back-office/reconciliation'

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('recon client — runs (BACKOFFICE-01)', () => {
  it('GETs /runs, returns rows + next_cursor, propagates the Bearer + trace', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ data: [{ run_id: 'RUN-1' }], meta: { next_cursor: 'C2' } }))
    const out = await listRuns(TOKEN, { limit: 10 }, { baseUrl: BASE, fetchImpl, traceId: 'trace-1' })

    expect(out.runs).toHaveLength(1)
    expect(out.next_cursor).toBe('C2')
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(`${BASE}${R}/runs?limit=10`)
    expect(init!.headers).toMatchObject({ authorization: `Bearer ${TOKEN}`, 'x-fapi-interaction-id': 'trace-1' })
  })

  it('throws a typed ReconApiError on a non-2xx', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ error: { code: 'BACKOFFICE.SCOPE_DENIED', message: 'no' } }, 403))
    await expect(listRuns(TOKEN, {}, { baseUrl: BASE, fetchImpl })).rejects.toBeInstanceOf(ReconApiError)
    await expect(listRuns(TOKEN, {}, { baseUrl: BASE, fetchImpl })).rejects.toMatchObject({ code: 'BACKOFFICE.SCOPE_DENIED', status: 403 })
  })
})

describe('recon client — breaks (BACKOFFICE-02)', () => {
  it('GETs /breaks with the queue filters', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ data: [], meta: {} }))
    await listBreaks(TOKEN, { status: 'flagged', run_id: 'RUN-1' }, { baseUrl: BASE, fetchImpl })
    expect(fetchImpl.mock.calls[0]![0]).toBe(`${BASE}${R}/breaks?run_id=RUN-1&status=flagged`)
  })
})

describe('recon client — claim (BACKOFFICE-03)', () => {
  it('POSTs /breaks/{id}/claim with a mandatory Idempotency-Key', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ data: { id: 'b1', status: 'claimed' } }))
    const out = await claimBreak(TOKEN, 'b1', 'idem-1', { baseUrl: BASE, fetchImpl })

    expect(out.status).toBe('claimed')
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(`${BASE}${R}/breaks/b1/claim`)
    expect(init!.method).toBe('POST')
    expect(init!.headers).toMatchObject({ 'idempotency-key': 'idem-1' })
  })
})

describe('recon client — resolve (BACKOFFICE-04/-06)', () => {
  it('POSTs /breaks/{id}/resolve with outcome + note and an Idempotency-Key', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ data: { id: 'b1', status: 'resolved' } }))
    const out = await resolveBreak(TOKEN, 'b1', { resolution_outcome: 'resolved_matched', resolution_note: 'matched after manual review xx' }, 'idem-2', { baseUrl: BASE, fetchImpl })

    expect(out.status).toBe('resolved')
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(`${BASE}${R}/breaks/b1/resolve`)
    expect(init!.method).toBe('POST')
    expect(init!.headers).toMatchObject({ 'idempotency-key': 'idem-2' })
    expect(JSON.parse(init!.body as string)).toEqual({ resolution_outcome: 'resolved_matched', resolution_note: 'matched after manual review xx' })
  })

  it('exposes the three contract resolution outcomes', () => {
    expect([...RESOLVE_OUTCOMES]).toEqual(['resolved_matched', 'resolved_internal_correction', 'escalated_fintech_billing'])
  })
})

describe('recon client — break detail + escalation (BACKOFFICE-11/-05)', () => {
  it('GETs /breaks/{id} for the three-source diff detail', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ data: { id: 'b1', status: 'flagged', source_a_ref: 'NB-1' } }))
    const out = await getBreak(TOKEN, 'b1', { baseUrl: BASE, fetchImpl })
    expect(out.source_a_ref).toBe('NB-1')
    expect(fetchImpl.mock.calls[0]![0]).toBe(`${BASE}${R}/breaks/b1`)
  })

  it('POSTs /breaks/{id}/escalate-nebras with a mandatory Idempotency-Key', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okJson({ data: { break_id: 'b1', status: 'escalated_nebras_dispute', nebras_dispute_case_id: 'NBR-9' } }))
    const out = await escalateToNebras(TOKEN, 'b1', 'idem-3', { baseUrl: BASE, fetchImpl })
    expect(out.nebras_dispute_case_id).toBe('NBR-9')
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(`${BASE}${R}/breaks/b1/escalate-nebras`)
    expect(init!.method).toBe('POST')
    expect(init!.headers).toMatchObject({ 'idempotency-key': 'idem-3' })
  })

  it('exposes the escalatable states (flagged|assigned)', () => {
    expect([...ESCALATABLE_STATES]).toEqual(['flagged', 'assigned'])
  })
})

describe('formatMoney', () => {
  it('renders integer minor units + ISO 4217 as major units; null → em dash', () => {
    expect(formatMoney({ amount: 145000, currency: 'AED' })).toBe('AED 1,450.00')
    expect(formatMoney(null)).toBe('—')
  })
})
