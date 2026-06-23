import { describe, it, expect, vi } from 'vitest'
import { ROUTES } from '@ofbo/contracts'
import {
  buildCatalog,
  routeAllowed,
  toolName,
  McpGateway,
  SpendGuard,
  SpendBudgetExceededError,
  classify,
  isConsequential,
  handleJsonRpc,
  type FetchLike
} from '../src/index.js'

// customer-care-agent persona scopes (a real SCOPE_MATRIX row) — least-privilege subset.
const CARE_SCOPES = ['consents:admin', 'disputes:admin', 'audit:read'] as const

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('catalog generation (ADR 0017)', () => {
  it('tool names are deterministic and collision-free across the whole contract', () => {
    const names = ROUTES.map(toolName)
    expect(new Set(names).size).toBe(ROUTES.length)
  })

  it('is read-only by default — no mutating tools until BACKOFFICE-53 spend-control', () => {
    const tools = buildCatalog({ scopes: CARE_SCOPES })
    expect(tools.length).toBeGreaterThan(0)
    expect(tools.every((t) => t.readOnly && t._route.method === 'get')).toBe(true)
    expect(tools.some((t) => t.name === 'get_consents_search_psu')).toBe(true)
    expect(tools.some((t) => t.name === 'post_consents_revoke_bulk')).toBe(false)
  })

  it('filters strictly to the agent scopes — never leaks operations outside the persona', () => {
    const tools = buildCatalog({ scopes: CARE_SCOPES, allowMutations: true })
    for (const t of tools) {
      const scope = t._route.scope
      if (scope !== null) expect(CARE_SCOPES).toContain(scope)
    }
    // A finance-only read (reconciliation:read) must NOT appear for a care agent.
    expect(tools.some((t) => t._route.scope === 'reconciliation:read')).toBe(false)
  })

  it('surfaces four-eyes operations only when mutations are allowed, flagged as four-eyes', () => {
    const tool = buildCatalog({ scopes: CARE_SCOPES, allowMutations: true }).find((t) => t.name === 'post_consents_revoke_bulk')
    expect(tool).toBeDefined()
    expect(tool!.fourEyes).toBe(true)
    expect(tool!.description).toContain('FOUR-EYES')
  })

  it('platform:superadmin is NOT a catalogue wildcard (BACKOFFICE-80 — agents never hold it)', () => {
    const superadminGated = ROUTES.find((r) => r.scope === 'platform:superadmin')
    if (superadminGated) {
      expect(routeAllowed(superadminGated, ['platform:superadmin'])).toBe(true)
      // a different scope set must not satisfy it
      expect(routeAllowed(superadminGated, CARE_SCOPES)).toBe(false)
    }
    // A non-superadmin route is gated purely by its own scope, never by a superadmin wildcard.
    const careRoute = ROUTES.find((r) => r.scope === 'consents:admin')!
    expect(routeAllowed(careRoute, ['platform:superadmin'])).toBe(false)
  })
})

describe('governance helpers', () => {
  it('classifies read / mutate / four-eyes from route metadata', () => {
    const get = ROUTES.find((r) => r.method === 'get')!
    const fourEyes = ROUTES.find((r) => r.fourEyes)!
    const mutate = ROUTES.find((r) => r.method === 'post' && !r.fourEyes)!
    expect(classify(get)).toBe('read')
    expect(classify(fourEyes)).toBe('four-eyes')
    expect(classify(mutate)).toBe('mutate')
    expect(isConsequential(get)).toBe(false)
    expect(isConsequential(mutate)).toBe(true)
    expect(isConsequential(fourEyes)).toBe(true)
  })

  it('SpendGuard bounds consequential ops and fires onExhausted (BACKOFFICE-53)', () => {
    const onExhausted = vi.fn()
    const guard = new SpendGuard(1, onExhausted)
    const mutate = ROUTES.find((r) => r.method === 'post' && !r.fourEyes)!
    const read = ROUTES.find((r) => r.method === 'get')!
    guard.consume(read) // reads are free
    expect(guard.remaining).toBe(1)
    guard.consume(mutate) // exhausts budget
    expect(guard.remaining).toBe(0)
    expect(onExhausted).toHaveBeenCalledTimes(1)
    expect(() => guard.consume(mutate)).toThrow(SpendBudgetExceededError)
  })
})

describe('McpGateway dispatch', () => {
  function gateway(fetchImpl: FetchLike, opts: Partial<{ allowMutations: boolean; spendBudget: number; onSpendExhausted: () => void }> = {}) {
    return new McpGateway({
      baseUrl: 'https://bff.example',
      session: { agentToken: 'agent-tok', scopes: CARE_SCOPES, sessionId: 'sess-1' },
      fetchImpl,
      ...opts
    })
  }

  it('attaches agent identity + trace on a read call and never sends a body', async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
      expect(url).toBe('https://bff.example/consents:search-psu?iban=AE07')
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer agent-tok')
      expect((init.headers as Record<string, string>)['x-fapi-interaction-id']).toBeTruthy()
      expect((init.headers as Record<string, string>)['idempotency-key']).toBeUndefined()
      expect(init.body).toBeUndefined()
      return jsonResponse({ data: { results: [] } })
    })
    const res = await gateway(fetchImpl).callTool('get_consents_search_psu', { query: { iban: 'AE07' } })
    expect(res).toEqual({ ok: true, status: 200, data: { results: [] } })
  })

  it('rejects a mutating tool that is not in the read-only catalogue (403, no fetch)', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({}))
    const res = await gateway(fetchImpl).callTool('post_consents_consent_id_revoke_admin', { consent_id: 'c1', body: { reason_code: 'TPP_REQUEST' } })
    expect(res.ok).toBe(false)
    expect((res as { status: number }).status).toBe(403)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends Idempotency-Key on a mutating call when mutations are allowed', async () => {
    const fetchImpl = vi.fn<FetchLike>(async (_url, init) => {
      const h = init.headers as Record<string, string>
      expect(init.method).toBe('POST')
      expect(h['idempotency-key']).toContain('sess-1:post_consents_consent_id_revoke_admin:')
      expect(init.body).toBe(JSON.stringify({ reason_code: 'TPP_REQUEST' }))
      return jsonResponse({ data: { state: 'revoked' } })
    })
    const res = await gateway(fetchImpl, { allowMutations: true, spendBudget: 5 }).callTool('post_consents_consent_id_revoke_admin', {
      consent_id: 'c1',
      body: { reason_code: 'TPP_REQUEST' }
    })
    expect(res).toEqual({ ok: true, status: 200, data: { state: 'revoked' } })
  })

  it('surfaces a four-eyes 202 as a pending approval and NEVER auto-approves (BACKOFFICE-44)', async () => {
    const calls: string[] = []
    const fetchImpl = vi.fn<FetchLike>(async (url) => {
      calls.push(url)
      return jsonResponse(
        {
          data: {
            approval_request_id: 'appr-1',
            operation_type: 'consents.bulk-revoke',
            approver_required_scope: 'consents:admin',
            expires_at: '2026-06-23T12:00:00Z'
          }
        },
        202
      )
    })
    const res = await gateway(fetchImpl, { allowMutations: true, spendBudget: 5 }).callTool('post_consents_revoke_bulk', {
      body: { psu_identifier: 'x' }
    })
    expect(res).toMatchObject({ ok: true, status: 202, pendingApproval: { status: 'pending_approval', approval_request_id: 'appr-1' } })
    // Exactly one request — the initiation. No follow-up approve call.
    expect(calls).toHaveLength(1)
    expect(calls[0]).not.toContain(':approve')
  })

  it('blocks further mutations once the session spend budget is exhausted', async () => {
    const onSpendExhausted = vi.fn()
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ data: { state: 'revoked' } }))
    const gw = gateway(fetchImpl, { allowMutations: true, spendBudget: 1, onSpendExhausted })
    await gw.callTool('post_consents_consent_id_revoke_admin', { consent_id: 'c1', body: {} })
    await expect(gw.callTool('post_consents_consent_id_revoke_admin', { consent_id: 'c2', body: {} })).rejects.toBeInstanceOf(SpendBudgetExceededError)
    expect(onSpendExhausted).toHaveBeenCalled()
    expect(gw.remainingBudget).toBe(0)
  })

  it('returns the BFF error envelope on a 4xx (gateway enforces nothing itself)', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ error: { code: 'BACKOFFICE.SCOPE_DENIED' } }, 403))
    const res = await gateway(fetchImpl).callTool('get_consents_search_psu', { query: {} })
    expect(res).toEqual({ ok: false, status: 403, error: { code: 'BACKOFFICE.SCOPE_DENIED' } })
  })
})

describe('MCP JSON-RPC surface', () => {
  const gw = new McpGateway({
    baseUrl: 'https://bff.example',
    session: { agentToken: 't', scopes: CARE_SCOPES, sessionId: 's' },
    fetchImpl: async () => jsonResponse({ data: {} })
  })

  it('initialize advertises tools capability', async () => {
    const res = await handleJsonRpc(gw, { jsonrpc: '2.0', id: 1, method: 'initialize' })
    expect(res.result).toMatchObject({ capabilities: { tools: {} }, serverInfo: { name: 'ofbo-mcp-gateway' } })
  })

  it('tools/list returns the scope-filtered catalogue with input schemas', async () => {
    const res = (await handleJsonRpc(gw, { jsonrpc: '2.0', id: 2, method: 'tools/list' })) as { result: { tools: unknown[] } }
    expect(res.result.tools.length).toBe(gw.listTools().length)
    expect(res.result.tools[0]).toHaveProperty('inputSchema')
  })

  it('tools/call dispatches and wraps the result as MCP content', async () => {
    const res = (await handleJsonRpc(gw, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'get_consents_search_psu', arguments: { query: {} } }
    })) as { result: { isError: boolean; content: { type: string; text: string }[] } }
    expect(res.result.isError).toBe(false)
    expect(JSON.parse(res.result.content[0]!.text)).toMatchObject({ ok: true })
  })

  it('unknown method yields a JSON-RPC method-not-found error', async () => {
    const res = await handleJsonRpc(gw, { jsonrpc: '2.0', id: 4, method: 'resources/list' })
    expect(res.error?.code).toBe(-32601)
  })
})
