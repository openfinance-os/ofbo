import { describe, it, expect } from 'vitest'
import { McpGateway, InMemoryAgentAnomalySink, type FetchLike } from '../src/index.js'

const CARE_SCOPES = ['consents:admin', 'disputes:admin', 'audit:read'] as const

const okFetch: FetchLike = async () => new Response(JSON.stringify({ data: { state: 'revoked' } }), { status: 200 })

describe('spend-control anomaly reporting (BACKOFFICE-53)', () => {
  it('emits an agent_anomaly event (Risk signal + ITSM shape) when the budget is reached', async () => {
    const sink = new InMemoryAgentAnomalySink()
    const gw = new McpGateway({
      baseUrl: 'https://bff.example',
      session: { agentToken: 't', scopes: CARE_SCOPES, sessionId: 'sess-9', personaId: 'care-agent' },
      allowMutations: true,
      spendBudget: 1,
      anomalySink: sink,
      fetchImpl: okFetch
    })

    await gw.callTool('post_consents_consent_id_revoke_admin', { consent_id: 'c1', body: {} })

    expect(sink.events).toHaveLength(1)
    expect(sink.events[0]).toMatchObject({
      type: 'agent_anomaly',
      reason: 'spend_budget_exhausted',
      agent_persona: 'care-agent',
      session_id: 'sess-9',
      budget: 1
    })
    // No PII in the anomaly event — agent/session telemetry only.
    expect(JSON.stringify(sink.events[0])).not.toMatch(/c1/)
  })

  it('does not emit for read-only sessions (reads are free)', async () => {
    const sink = new InMemoryAgentAnomalySink()
    const gw = new McpGateway({
      baseUrl: 'https://bff.example',
      session: { agentToken: 't', scopes: CARE_SCOPES, sessionId: 'sess-10', personaId: 'care-readonly' },
      anomalySink: sink,
      fetchImpl: async () => new Response(JSON.stringify({ data: {} }), { status: 200 })
    })
    await gw.callTool('get_consents_search_psu', { query: {} })
    expect(sink.events).toHaveLength(0)
  })
})
