import { describe, it, expect, vi } from 'vitest'
import {
  fetchAgentRegistration,
  mintAgentSession,
  sessionFromRegistration,
  AgentRegistryLookupError,
  McpGateway,
  type AgentRegistration,
  type FetchLike
} from '../src/index.js'

const reg = (overrides: Partial<AgentRegistration> = {}): AgentRegistration => ({
  agent_id: 'a-1',
  persona: 'reconciliation-readonly-agent',
  derived_from: 'finance-analyst',
  scopes: ['reconciliation:read', 'billing:read'],
  status: 'active',
  allow_mutations: false,
  spend_budget: 0,
  ...overrides
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('sessionFromRegistration (the gateway adopts the registered identity)', () => {
  it('adopts the registration scopes, allow_mutations and spend_budget', () => {
    const { session, allowMutations, spendBudget } = sessionFromRegistration(reg({ allow_mutations: true, spend_budget: 7 }), { sessionId: 's' })
    expect(session.scopes).toEqual(['reconciliation:read', 'billing:read'])
    expect(session.personaId).toBe('reconciliation-readonly-agent')
    expect(allowMutations).toBe(true)
    expect(spendBudget).toBe(7)
  })

  it('defaults the operational token to the demo IdP token of the human persona, or uses an explicit one', () => {
    expect(sessionFromRegistration(reg(), { sessionId: 's' }).session.agentToken).toBe('demo-token:finance-analyst')
    expect(sessionFromRegistration(reg(), { sessionId: 's', agentToken: 'dcr-cred' }).session.agentToken).toBe('dcr-cred')
  })

  it('refuses to drive the gateway from a non-active agent (revoked / pending)', () => {
    expect(() => sessionFromRegistration(reg({ status: 'revoked' }), { sessionId: 's' })).toThrow(AgentRegistryLookupError)
    expect(() => sessionFromRegistration(reg({ status: 'pending' }), { sessionId: 's' })).toThrow(/not active/)
  })

  it('feeds a gateway whose catalogue reflects exactly the registered scopes', () => {
    const { session, allowMutations, spendBudget } = sessionFromRegistration(reg(), { sessionId: 's' })
    const gw = new McpGateway({ baseUrl: '', session, allowMutations, spendBudget, fetchImpl: async () => jsonResponse({ data: {} }) })
    const names = gw.listTools().map((t) => t.name)
    expect(names.some((n) => n.includes('reconciliation'))).toBe(true)
    // a care-only operation is not in this agent's catalogue
    expect(names).not.toContain('get_consents_search_psu')
  })
})

describe('fetchAgentRegistration (reads the registry under an admin token)', () => {
  it('GETs /back-office/agents/{id} with the admin bearer and returns the registration', async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
      expect(url).toBe('https://bff.example/back-office/agents/a-9')
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer demo-token:platform-admin')
      return jsonResponse({ data: reg({ agent_id: 'a-9' }) })
    })
    const got = await fetchAgentRegistration({ baseUrl: 'https://bff.example', adminToken: 'demo-token:platform-admin', agentId: 'a-9', fetchImpl })
    expect(got.agent_id).toBe('a-9')
  })

  it('maps 404 to not_found and other errors to lookup_failed', async () => {
    await expect(
      fetchAgentRegistration({ baseUrl: 'x', adminToken: 't', agentId: 'missing', fetchImpl: async () => jsonResponse({ error: { message: 'nope' } }, 404) })
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      fetchAgentRegistration({ baseUrl: 'x', adminToken: 't', agentId: 'a', fetchImpl: async () => jsonResponse({ error: { message: 'boom' } }, 403) })
    ).rejects.toMatchObject({ code: 'lookup_failed' })
  })
})

describe('mintAgentSession (ADR 0018 — the gateway gets a server-verified session token)', () => {
  it('POSTs :mint-session under the admin token with an Idempotency-Key and returns the token + session_id', async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
      expect(url).toBe('https://bff.example/back-office/agents/a-9:mint-session')
      expect(init.method).toBe('POST')
      const headers = init.headers as Record<string, string>
      expect(headers.authorization).toBe('Bearer demo-token:platform-admin')
      expect(headers['idempotency-key']).toBeTruthy()
      return jsonResponse({ data: { session_token: 'agent-session.abc.def', session_id: 'sess-9' } })
    })
    const got = await mintAgentSession({ baseUrl: 'https://bff.example', adminToken: 'demo-token:platform-admin', agentId: 'a-9', fetchImpl })
    expect(got).toEqual({ session_token: 'agent-session.abc.def', session_id: 'sess-9' })
  })

  it('throws lookup_failed when mint is refused (e.g. a non-active agent → 409)', async () => {
    await expect(
      mintAgentSession({ baseUrl: 'x', adminToken: 't', agentId: 'a', fetchImpl: async () => jsonResponse({ error: { message: 'not active' } }, 409) })
    ).rejects.toMatchObject({ code: 'lookup_failed' })
  })
})
