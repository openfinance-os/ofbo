import { describe, expect, it, vi } from 'vitest'
import { createStrWorkflowAdapter, strWorkflowFromEnv, StrWorkflowError } from '../src/adapters/enterprise/str-workflow.js'

/**
 * BACKOFFICE-63 — P10 STR workflow enterprise adapter contract (ADR 0022). The Back Office
 * hands an approved STR draft to the bank's STR workflow, which files with AML GO — the only
 * outbound call is this handoff (no AML GO client). Transport injected; the fail-closed config
 * and the real call→parse path are exercised with a fake fetch (no backend).
 */

const trace = { trace_id: '4d2c2e2a-0000-4000-8000-000000000000' }
const BASE = 'https://str-workflow.bank.example'
const DRAFT = { str_draft_id: '5f0e63c0-0000-4000-8000-0000000000a1', source_consent_id: '22222222-2222-4222-8222-222222222222', case_context: 'synthetic' }

function fakeTransport(route: { status?: number; body?: unknown } = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify(route.body ?? {}), { status: route.status ?? 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

describe('P10 str-workflow adapter (one-way handoff — never AML GO directly)', () => {
  it('hands off a draft and returns the workflow ref + accepted_at, with auth + trace headers', async () => {
    const { calls, fetchImpl } = fakeTransport({ body: { workflow_ref: 'STR-WF-2026-001', accepted_at: '2026-07-04T00:00:00.000Z' } })
    const adapter = createStrWorkflowAdapter({ baseUrl: BASE, getToken: async () => 'tok', fetchImpl })
    const r = await adapter.handoffStrDraft(DRAFT, trace)
    expect(r).toEqual({ workflow_ref: 'STR-WF-2026-001', accepted_at: '2026-07-04T00:00:00.000Z' })
    expect(calls[0]!.url).toBe(`${BASE}/str-drafts`)
    expect(calls[0]!.init.method).toBe('POST')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer tok')
    expect(headers['x-fapi-interaction-id']).toBe(trace.trace_id)
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(DRAFT)
  })

  it('throws retryable on 5xx and 429, non-retryable on 4xx', async () => {
    await expect(createStrWorkflowAdapter({ baseUrl: BASE, getToken: async () => 't', fetchImpl: fakeTransport({ status: 503 }).fetchImpl }).handoffStrDraft(DRAFT, trace)).rejects.toMatchObject({ retryable: true, status: 503 })
    await expect(createStrWorkflowAdapter({ baseUrl: BASE, getToken: async () => 't', fetchImpl: fakeTransport({ status: 429 }).fetchImpl }).handoffStrDraft(DRAFT, trace)).rejects.toMatchObject({ retryable: true, status: 429 })
    await expect(createStrWorkflowAdapter({ baseUrl: BASE, getToken: async () => 't', fetchImpl: fakeTransport({ status: 400 }).fetchImpl }).handoffStrDraft(DRAFT, trace)).rejects.toMatchObject({ retryable: false, status: 400 })
  })

  it('throws when the workflow returns no workflow_ref / accepted_at', async () => {
    await expect(createStrWorkflowAdapter({ baseUrl: BASE, getToken: async () => 't', fetchImpl: fakeTransport({ body: { workflow_ref: 'x' } }).fetchImpl }).handoffStrDraft(DRAFT, trace)).rejects.toBeInstanceOf(StrWorkflowError)
    await expect(createStrWorkflowAdapter({ baseUrl: BASE, getToken: async () => 't', fetchImpl: fakeTransport({ body: {} }).fetchImpl }).handoffStrDraft(DRAFT, trace)).rejects.toBeInstanceOf(StrWorkflowError)
  })

  it('fail-closed: requires baseUrl + token, and fromEnv throws when unset', () => {
    expect(() => createStrWorkflowAdapter({ baseUrl: BASE })).toThrow(StrWorkflowError)
    expect(() => createStrWorkflowAdapter({ getToken: async () => 't' })).toThrow(StrWorkflowError)
    expect(() => strWorkflowFromEnv({})).toThrow(/misconfigured/)
    expect(() => strWorkflowFromEnv({ STR_WORKFLOW_URL: BASE })).toThrow(/misconfigured/)
  })

  it('fromEnv builds a working adapter when configured', async () => {
    const adapter = strWorkflowFromEnv({ STR_WORKFLOW_URL: BASE, STR_WORKFLOW_TOKEN: 'env-tok' })
    expect(adapter).toBeDefined()
    expect(typeof adapter.handoffStrDraft).toBe('function')
  })
})
