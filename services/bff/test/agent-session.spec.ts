import { describe, expect, it } from 'vitest'
import { getAdapter } from '@ofbo/ports'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { InMemoryRiskSignalSink } from '../src/superadmin.js'
import { InMemoryAgentStore, type StoredAgent } from '../src/agents/service.js'
import { FAPI_HEADERS, FIXED_UUID } from './helpers.js'

/**
 * ADR 0018 (Option 2) — end-to-end agent identity at the BFF. A registered agent's session
 * token is minted by P2, presented to the BFF, verified into a first-class agent Principal,
 * and the registration's allow_mutations / spend_budget are re-asserted BFF-side
 * (BACKOFFICE-53's defence-in-depth criterion — the gateway guard is never the sole layer).
 */

const idp = getAdapter('p2-identity-provider', 'demo')

function seedAgent(over: Partial<StoredAgent> = {}): StoredAgent {
  return {
    agent_id: 'agent-int-1',
    client_id: 'agent-client-1',
    display_name: 'Integration agent',
    persona: 'care-readonly-agent',
    derived_from: 'customer-care-agent',
    scopes: ['consents:admin', 'audit:read'],
    status: 'active',
    allow_mutations: false,
    spend_budget: 0,
    registered_by: 'demo:platform-admin',
    approved_by: 'demo:platform-super-admin',
    created_at: '2026-06-01T00:00:00.000Z',
    revoked_at: null,
    revoke_reason: null,
    ...over
  }
}

async function appWith(agent?: StoredAgent) {
  const store = new InMemoryAgentStore()
  if (agent) await store.create(agent, 'seed')
  const highClassAudit = new InMemoryHighClassAuditSink()
  const riskSignals = new InMemoryRiskSignalSink()
  const tickets: { type: string; severity: string; team: string; summary: string }[] = []
  const itsm = {
    createTicket: async (input: { type: string; severity: 'low' | 'medium' | 'high' | 'critical'; team: string; summary: string }) => {
      tickets.push(input)
      return { ticket_id: `itsm-${tickets.length}` }
    }
  }
  const app = createApp({ idp, agentStore: store, highClassAudit, superadmin: { riskSignals, itsm } })
  return { app, store, highClassAudit, riskSignals, tickets }
}

const adminHdr = (key: string) => ({
  ...FAPI_HEADERS,
  authorization: 'Bearer demo-token:platform-admin',
  'content-type': 'application/json',
  'idempotency-key': key
})

async function mint(app: Awaited<ReturnType<typeof appWith>>['app'], agentId: string, key = 'm1') {
  return app.request(`/back-office/agents/${agentId}:mint-session`, { method: 'POST', headers: adminHdr(key), body: '{}' })
}

interface SessionData {
  session_token: string
  agent_id: string
  session_id: string
  scopes: string[]
  allow_mutations: boolean
  spend_budget: number
  expires_at: string
}
const sessionOf = async (res: Response) => (await res.json() as { data: SessionData }).data

const agentGet = (app: Awaited<ReturnType<typeof appWith>>['app'], path: string, token: string) =>
  app.request(path, { headers: { ...FAPI_HEADERS, authorization: `Bearer ${token}` } })

const agentPost = (app: Awaited<ReturnType<typeof appWith>>['app'], path: string, token: string) =>
  app.request(path, {
    method: 'POST',
    headers: { ...FAPI_HEADERS, authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': 'op-1' },
    body: JSON.stringify({ reason: 'agent attempt' })
  })

describe('ADR 0018 — agent session mint endpoint', () => {
  it('mints a session token for an active agent (200) and High-class audits it', async () => {
    const { app, highClassAudit } = await appWith(seedAgent())
    const res = await mint(app, 'agent-int-1')
    expect(res.status).toBe(200)
    const data = await sessionOf(res)
    expect(data.session_token).toMatch(/^agent-session\./)
    expect(data.agent_id).toBe('agent-int-1')
    expect(data.session_id).toBeTruthy()
    expect(data.scopes).toEqual(['consents:admin', 'audit:read'])
    const minted = highClassAudit.events.find((e) => e.event_type === 'agent_session_minted')
    expect(minted?.acting_principal).toBe('agent-int-1')
  })

  it('rejects mint for an unknown agent (404)', async () => {
    const { app } = await appWith(seedAgent())
    expect((await mint(app, 'nope')).status).toBe(404)
  })

  it('rejects mint for a non-active agent (409)', async () => {
    const { app } = await appWith(seedAgent({ status: 'pending' }))
    const res = await mint(app, 'agent-int-1')
    expect(res.status).toBe(409)
    expect((await res.json() as { error: { code: string } }).error.code).toBe('BACKOFFICE.AGENT_NOT_ACTIVE')
  })

  it('denies mint to a persona without platform:agents:read (403)', async () => {
    const { app } = await appWith(seedAgent())
    const res = await app.request('/back-office/agents/agent-int-1:mint-session', {
      method: 'POST',
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:customer-care-agent', 'content-type': 'application/json', 'idempotency-key': 'm1' },
      body: '{}'
    })
    expect(res.status).toBe(403)
  })

  it('replays an idempotent mint (same key → same session; fresh key → fresh session)', async () => {
    const { app } = await appWith(seedAgent())
    const a = await sessionOf(await mint(app, 'agent-int-1', 'same'))
    const b = await sessionOf(await mint(app, 'agent-int-1', 'same'))
    const c = await sessionOf(await mint(app, 'agent-int-1', 'different'))
    expect(b.session_id).toBe(a.session_id)
    expect(c.session_id).not.toBe(a.session_id)
  })
})

describe('ADR 0018 — agent session authentication + BFF-side enforcement', () => {
  it('authenticates the minted token as the agent and reaches a scoped read', async () => {
    const { app } = await appWith(seedAgent())
    const { session_token } = await sessionOf(await mint(app, 'agent-int-1'))
    const res = await agentGet(app, '/audit/events', session_token) // audit:read — held by the agent
    expect(res.status).toBe(200)
  })

  it('blocks a consequential op when the registration is read-only (allow_mutations=false → 403)', async () => {
    const { app } = await appWith(seedAgent({ allow_mutations: false }))
    const { session_token } = await sessionOf(await mint(app, 'agent-int-1'))
    const res = await agentPost(app, `/consents/${FIXED_UUID}:revoke-admin`, session_token)
    expect(res.status).toBe(403)
    expect((await res.json() as { error: { code: string } }).error.code).toBe('BACKOFFICE.AGENT_MUTATIONS_DISABLED')
  })

  it('429s an exhausted budget and raises the agent_anomaly Risk signal + ITSM ticket BFF-side', async () => {
    const { app, riskSignals, tickets } = await appWith(seedAgent({ allow_mutations: true, spend_budget: 0 }))
    const { session_token } = await sessionOf(await mint(app, 'agent-int-1'))
    const res = await agentPost(app, `/consents/${FIXED_UUID}:revoke-admin`, session_token)
    expect(res.status).toBe(429)
    expect((await res.json() as { error: { code: string } }).error.code).toBe('BACKOFFICE.SPEND_BUDGET_EXCEEDED')
    expect(riskSignals.signals.filter((s) => s.signal_type === 'agent_anomaly')).toHaveLength(1)
    expect(tickets.filter((t) => t.type === 'agent_spend_anomaly')).toHaveLength(1)
  })

  it('rejects a session whose agent was revoked after minting (401 — immediate kill switch)', async () => {
    const { app, store } = await appWith(seedAgent())
    const { session_token } = await sessionOf(await mint(app, 'agent-int-1'))
    expect((await agentGet(app, '/audit/events', session_token)).status).toBe(200)
    await store.update('agent-int-1', { status: 'revoked' }, 'kill')
    const res = await agentGet(app, '/audit/events', session_token)
    expect(res.status).toBe(401)
    expect((await res.json() as { error: { code: string } }).error.code).toBe('BACKOFFICE.AGENT_REVOKED')
  })

  it('strips platform:superadmin from an agent credential even if the registration carries it (BACKOFFICE-80)', async () => {
    // A misconfigured registration that somehow holds superadmin must NOT let the agent satisfy
    // every scope — the credential is stripped, so a scope it does not hold is still denied.
    const { app } = await appWith(seedAgent({ scopes: ['audit:read', 'platform:superadmin'] }))
    const { session_token } = await sessionOf(await mint(app, 'agent-int-1'))
    expect((await agentGet(app, '/audit/events', session_token)).status).toBe(200) // audit:read held
    const denied = await agentGet(app, '/back-office/reconciliation/runs', session_token) // reconciliation:read NOT held
    expect(denied.status).toBe(403)
  })
})
