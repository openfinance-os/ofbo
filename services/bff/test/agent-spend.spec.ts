import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { Principal } from '../src/auth.js'
import { InMemoryRiskSignalSink } from '../src/superadmin.js'
import { AgentSpendLedger, createAgentSpendMiddleware } from '../src/agents/spend.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-53 / ADR 0018 — BFF-side agentic spend-control middleware. Exercised in
 * isolation (a tiny Hono app that injects a principal) so every branch is deterministic:
 * read pass-through, read-only block, budget pre-flight + commit-on-success, and the
 * BFF-side agent_anomaly auto-raise (Risk signal + ITSM) on first exhaustion.
 */

function agentPrincipal(over: Partial<NonNullable<Principal['agent']>> = {}): Principal {
  return {
    subject: 'agent-1',
    persona: 'care-readonly-agent',
    scopes: ['consents:admin'],
    agent: { agent_id: 'agent-1', session_id: 'sess-1', allow_mutations: true, spend_budget: 2, ...over }
  }
}

function build(principal: Principal, opts: { failPost?: boolean } = {}) {
  const ledger = new AgentSpendLedger()
  const riskSignals = new InMemoryRiskSignalSink()
  const tickets: { type: string; severity: string; team: string; summary: string }[] = []
  const itsm = {
    createTicket: async (input: { type: string; severity: 'low' | 'medium' | 'high' | 'critical'; team: string; summary: string }) => {
      tickets.push(input)
      return { ticket_id: `itsm-${tickets.length}` }
    }
  }
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.set('principal', principal)
    await next()
  })
  app.use('*', createAgentSpendMiddleware({ ledger, riskSignals, itsm }))
  app.get('/x', (c) => c.json({ ok: true }))
  app.post('/x', (c) => (opts.failPost ? c.json({ error: 'boom' }, 400) : c.json({ ok: true })))
  return { app, ledger, riskSignals, tickets }
}

const post = (app: ReturnType<typeof build>['app']) => app.request('/x', { method: 'POST', headers: FAPI_HEADERS })
const get = (app: ReturnType<typeof build>['app']) => app.request('/x', { method: 'GET', headers: FAPI_HEADERS })

describe('BACKOFFICE-53 — BFF-side agent spend-control', () => {
  it('lets human sessions (no agent) through untouched', async () => {
    const { app } = build({ subject: 'demo:customer-care-agent', persona: 'customer-care-agent', scopes: ['consents:admin'] })
    expect((await post(app)).status).toBe(200)
  })

  it('never consumes budget on reads', async () => {
    const { app, ledger } = build(agentPrincipal())
    expect((await get(app)).status).toBe(200)
    expect((await get(app)).status).toBe(200)
    expect(ledger.spent('agent-1', 'sess-1')).toBe(0)
  })

  it('blocks every consequential op when the registration is read-only (allow_mutations=false, 403)', async () => {
    const { app } = build(agentPrincipal({ allow_mutations: false }))
    const res = await post(app)
    expect(res.status).toBe(403)
    expect((await res.json() as { error: { code: string } }).error.code).toBe('BACKOFFICE.AGENT_MUTATIONS_DISABLED')
  })

  it('consumes budget on a successful mutation and 429s once exhausted', async () => {
    const { app, ledger } = build(agentPrincipal({ spend_budget: 2 }))
    expect((await post(app)).status).toBe(200) // 1/2
    expect((await post(app)).status).toBe(200) // 2/2
    expect(ledger.spent('agent-1', 'sess-1')).toBe(2)
    const exhausted = await post(app)
    expect(exhausted.status).toBe(429)
    expect((await exhausted.json() as { error: { code: string } }).error.code).toBe('BACKOFFICE.SPEND_BUDGET_EXCEEDED')
  })

  it('does NOT burn budget on a rejected mutation (commit on success only)', async () => {
    const { app, ledger } = build(agentPrincipal({ spend_budget: 2 }), { failPost: true })
    expect((await post(app)).status).toBe(400)
    expect((await post(app)).status).toBe(400)
    expect(ledger.spent('agent-1', 'sess-1')).toBe(0)
  })

  it('raises the agent_anomaly Risk signal + ITSM ticket BFF-side on first exhaustion, exactly once', async () => {
    const { app, riskSignals, tickets } = build(agentPrincipal({ spend_budget: 0 }))
    // budget 0 → the first consequential op is already over budget.
    expect((await post(app)).status).toBe(429)
    expect((await post(app)).status).toBe(429)
    expect(riskSignals.signals).toHaveLength(1)
    expect(riskSignals.signals[0]!.signal_type).toBe('agent_anomaly')
    expect(riskSignals.signals[0]!.acting_principal).toBe('agent-1')
    expect(tickets).toHaveLength(1)
    expect(tickets[0]!.type).toBe('agent_spend_anomaly')
    expect(tickets[0]!.team).toBe('risk')
  })

  it('keys the budget per (agent_id, session_id) — a fresh session starts clean', async () => {
    const { app: s1, ledger } = build(agentPrincipal({ session_id: 'sess-A', spend_budget: 1 }))
    expect((await post(s1)).status).toBe(200)
    expect((await post(s1)).status).toBe(429)
    expect(ledger.spent('agent-1', 'sess-A')).toBe(1)
    expect(ledger.spent('agent-1', 'sess-B')).toBe(0)
  })
})
