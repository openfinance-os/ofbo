import { describe, it, expect } from 'vitest'
import { createApp } from '@ofbo/bff'
import { McpGateway, type FetchLike } from '../src/index.js'
import { AGENT_PERSONAS } from '../src/index.js'

/**
 * Proves the self-contained demo wiring (demo-server.ts) works end to end: the gateway
 * dispatches tool calls straight into the in-process demo BFF (seeded synthetic data),
 * with no socket and no external network. This is what a Claude client gets when it
 * connects via .mcp.json.
 */
const persona = AGENT_PERSONAS['care-readonly-agent']

function demoGateway(allowMutations = false) {
  const app = createApp()
  const inProcessFetch: FetchLike = (url, init) => Promise.resolve(app.request(url, init))
  return new McpGateway({
    baseUrl: '',
    session: {
      agentToken: `demo-token:${persona.derivedFrom}`,
      scopes: persona.scopes,
      sessionId: 'demo-sess',
      personaId: persona.id
    },
    allowMutations,
    spendBudget: allowMutations ? 25 : 0,
    fetchImpl: inProcessFetch
  })
}

describe('OFBO demo MCP server (in-process BFF)', () => {
  it('read-only catalogue exposes consent lookup + audit, no mutating tools', () => {
    const tools = demoGateway(false).listTools()
    const names = tools.map((t) => t.name)
    expect(names).toContain('get_consents_search_psu')
    expect(tools.every((t) => t.readOnly)).toBe(true)
    expect(names).not.toContain('post_consents_consent_id_revoke_admin')
  })

  it('looks up a seeded demo PSU through the agent tool', async () => {
    const res = await demoGateway(false).callTool('get_consents_search_psu', {
      query: { identifier_type: 'bank_customer_id', identifier: 'cust-0001' }
    })
    expect(res.ok).toBe(true)
    expect((res as { status: number }).status).toBe(200)
    // The demo directory resolves cust-0001 to a PSU with consents (synthetic, zero PII).
    const data = (res as { data: { consents?: unknown[] } }).data
    expect(Array.isArray(data.consents)).toBe(true)
  })

  it('with mutations enabled, exposes single-consent revoke and reaches the governed path', async () => {
    const gw = demoGateway(true)
    expect(gw.listTools().some((t) => t.name === 'post_consents_consent_id_revoke_admin')).toBe(true)

    // Find a revocable (Authorized/Suspended) consent for the demo PSU.
    const search = await gw.callTool('get_consents_search_psu', {
      query: { identifier_type: 'bank_customer_id', identifier: 'cust-0001' }
    })
    const consents = (search as { data: { consents: Array<{ consent_id: string; status: string }> } }).data.consents
    expect(consents.length).toBeGreaterThan(0)
    const target = consents.find((c) => c.status === 'Authorized' || c.status === 'Suspended') ?? consents[0]!

    const revoke = await gw.callTool('post_consents_consent_id_revoke_admin', {
      consent_id: target.consent_id,
      body: { reason_code: 'TPP_REQUEST' }
    })
    // The agent reached the BFF's governed revoke (consents:admin, not four-eyes → executes
    // inline). It must NOT be blocked by auth/scope (401/403); a revocable consent → 200.
    const status = (revoke as { status: number }).status
    expect(status).not.toBe(401)
    expect(status).not.toBe(403)
    if (target.status === 'Authorized' || target.status === 'Suspended') {
      expect(revoke.ok).toBe(true)
      expect(status).toBe(200)
    }
  })
})
