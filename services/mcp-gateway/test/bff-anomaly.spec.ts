import { describe, it, expect } from 'vitest'
import { McpGateway, BffBackedAnomalySink, type FetchLike, type AgentRiskSignalRecorder, type AgentItsmRaiser } from '../src/index.js'

const CARE = ['consents:admin', 'audit:read'] as const
const okFetch: FetchLike = async () => new Response(JSON.stringify({ data: { state: 'revoked' } }), { status: 200 })
const flush = () => new Promise((r) => setTimeout(r, 0))

/**
 * BACKOFFICE-53 — when an agent session hits its spend budget, the gateway raises a real
 * Risk signal (agent_anomaly) + an ITSM ticket into the same sinks the BACKOFFICE-80
 * guardrails use. No PSU PII.
 */
describe('BffBackedAnomalySink (spend-exhaustion auto-raise)', () => {
  it('records an agent_anomaly Risk signal + raises an ITSM ticket when the budget is hit', async () => {
    const signals: Array<Record<string, unknown>> = []
    const tickets: Array<Record<string, unknown>> = []
    const riskSignals: AgentRiskSignalRecorder = { record: async (e) => void signals.push(e) }
    const itsm: AgentItsmRaiser = { createTicket: async (i) => (tickets.push(i), {}) }

    const gw = new McpGateway({
      baseUrl: '',
      session: { agentToken: 't', scopes: CARE, sessionId: 'sess-x', personaId: 'care-agent' },
      allowMutations: true,
      spendBudget: 1,
      anomalySink: new BffBackedAnomalySink({ riskSignals, itsm }),
      fetchImpl: okFetch
    })

    await gw.callTool('post_consents_consent_id_revoke_admin', { consent_id: 'SENSITIVE-CONSENT-ID', body: { reason_code: 'TPP_REQUEST' } })
    await flush()

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({ signal_type: 'agent_anomaly', severity: 'info', acting_principal: 'care-agent' })
    expect(tickets).toHaveLength(1)
    expect(tickets[0]).toMatchObject({ type: 'agent_spend_anomaly', team: 'risk', severity: 'medium' })
    // No PSU PII / target id reaches the Risk signal / ticket — agent + session telemetry only.
    expect(JSON.stringify([signals, tickets])).not.toContain('SENSITIVE-CONSENT-ID')
  })

  it('does not raise for read-only sessions (reads are free)', async () => {
    const signals: unknown[] = []
    const gw = new McpGateway({
      baseUrl: '',
      session: { agentToken: 't', scopes: CARE, sessionId: 's', personaId: 'care-agent' },
      anomalySink: new BffBackedAnomalySink({ riskSignals: { record: async (e) => void signals.push(e) }, itsm: { createTicket: async () => ({}) } }),
      fetchImpl: async () => new Response(JSON.stringify({ data: {} }), { status: 200 })
    })
    await gw.callTool('get_consents_search_psu', { query: {} })
    await flush()
    expect(signals).toHaveLength(0)
  })
})
