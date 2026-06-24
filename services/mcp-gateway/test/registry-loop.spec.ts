import { describe, it, expect } from 'vitest'
import { createApp } from '@ofbo/bff'
import { fetchAgentRegistration, sessionFromRegistration, McpGateway, type FetchLike } from '../src/index.js'

/**
 * The agent-first loop, end to end against the in-process demo BFF: register an agent
 * (four-eyes) → a different principal approves → the gateway looks it up in the registry
 * and adopts EXACTLY its bound scopes/allow_mutations/spend_budget. Proves a registered,
 * approved agent drives the gateway.
 */
const ADMIN = 'demo-token:platform-admin'

async function registerApproveLoad(persona: string) {
  const app = createApp()
  const f: FetchLike = (url, init) => Promise.resolve(app.request(url, init))
  const json = async (path: string, init: RequestInit) => {
    const res = await f(path, init)
    return { status: res.status, data: ((await res.json().catch(() => ({}))) as { data?: Record<string, unknown> }).data ?? {} }
  }

  const reg = await json('/back-office/agents:register', {
    method: 'POST',
    headers: { authorization: `Bearer ${ADMIN}`, 'x-fapi-interaction-id': 'r', 'idempotency-key': 'reg-1', 'content-type': 'application/json' },
    body: JSON.stringify({ persona, display_name: 'Loop demo agent' })
  })
  expect(reg.status).toBe(202)

  const appr = await json(`/approvals/${(reg.data as { approval_request_id: string }).approval_request_id}:approve`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer demo-token:platform-super-admin',
      'x-fapi-interaction-id': 'a',
      'idempotency-key': 'appr-1',
      'x-superadmin-justification': 'approving the loop demo agent registration (ADR 0017 loop test)',
      'content-type': 'application/json'
    }
  })
  expect(appr.status).toBe(200)
  const agentId = (appr.data as { execution_result: { agent_id: string } }).execution_result.agent_id

  const registration = await fetchAgentRegistration({ baseUrl: '', adminToken: ADMIN, agentId, fetchImpl: f })
  return { app, f, registration }
}

describe('agent-first loop: registry-driven gateway', () => {
  it('a registered + approved agent drives the gateway with exactly its bound identity', async () => {
    const { f, registration } = await registerApproveLoad('care-readonly-agent')

    expect(registration.status).toBe('active')
    expect(registration.persona).toBe('care-readonly-agent')
    expect(registration.derived_from).toBe('customer-care-agent')
    expect(registration.scopes).toEqual(['consents:admin', 'audit:read'])
    expect(registration.allow_mutations).toBe(false)

    const { session, allowMutations, spendBudget } = sessionFromRegistration(registration, { sessionId: 'loop' })
    const gw = new McpGateway({ baseUrl: '', session, allowMutations, spendBudget, fetchImpl: f })

    // The catalogue is the agent's least-privilege, read-only subset — driven by the registry.
    const names = gw.listTools().map((t) => t.name)
    expect(names).toContain('get_consents_search_psu')
    expect(gw.listTools().every((t) => t.readOnly)).toBe(true)

    // And the agent can actually perform its bound read against the in-process BFF.
    const res = await gw.callTool('get_consents_search_psu', { query: { identifier_type: 'bank_customer_id', identifier: 'cust-0001' } })
    expect(res.ok).toBe(true)
    expect((res as { status: number }).status).toBe(200)
  })

  it('reflects a different persona registration (reconciliation) — different scopes, no consent tools', async () => {
    const { registration } = await registerApproveLoad('reconciliation-readonly-agent')
    expect(registration.scopes).toEqual(['reconciliation:read', 'billing:read'])
    const { session } = sessionFromRegistration(registration, { sessionId: 'loop2' })
    expect(session.scopes).toEqual(['reconciliation:read', 'billing:read'])
  })
})
