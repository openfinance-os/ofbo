import { describe, expect, it } from 'vitest'
import { getAdapter } from '@ofbo/ports'
import { createApp } from '../src/app.js'
import { SCOPE_MATRIX } from '../src/auth.js'
import { AGENT_PERSONAS, isLeastPrivilege, type AgentPersonaDef } from '../src/agents/personas.js'
import { FAPI_HEADERS } from './helpers.js'

const idp = getAdapter('p2-identity-provider', 'demo')

const hdr = (persona: string, extra: Record<string, string> = {}) => ({
  ...FAPI_HEADERS,
  authorization: `Bearer demo-token:${persona}`,
  'content-type': 'application/json',
  ...extra
})
// platform-super-admin mutations carry the BACKOFFICE-80 justification.
const superApprove = (key: string) =>
  hdr('platform-super-admin', { 'idempotency-key': key, 'x-superadmin-justification': 'approving agent registration in the four-eyes test (BACKOFFICE-60)' })

async function registerAndApprove(app: ReturnType<typeof createApp>, body: Record<string, unknown>, n: string) {
  const reg = await app.request('/back-office/agents:register', {
    method: 'POST',
    headers: hdr('platform-admin', { 'idempotency-key': `reg-${n}` }),
    body: JSON.stringify(body)
  })
  expect(reg.status).toBe(202)
  const { data } = (await reg.json()) as { data: { approval_request_id: string; state: string } }
  expect(data.state).toBe('pending')
  const appr = await app.request(`/approvals/${data.approval_request_id}:approve`, { method: 'POST', headers: superApprove(`appr-${n}`) })
  expect(appr.status).toBe(200)
  return data.approval_request_id
}

describe('BACKOFFICE-60 — agent DCR registry', () => {
  it('register is denied without platform:agents:write (scope middleware, 403)', async () => {
    const app = createApp({ idp })
    const res = await app.request('/back-office/agents:register', {
      method: 'POST',
      headers: hdr('customer-care-agent', { 'idempotency-key': 'x1' }),
      body: JSON.stringify({ persona: 'care-readonly-agent', display_name: 'Care Bot' })
    })
    expect(res.status).toBe(403)
  })

  it('register is four-eyes (202 + approval_request) and creates the agent only on a different principal’s approval', async () => {
    const app = createApp({ idp })
    await registerAndApprove(app, { persona: 'care-readonly-agent', display_name: 'Care Bot' }, 'a')

    const list = await app.request('/back-office/agents', { headers: hdr('platform-admin') })
    expect(list.status).toBe(200)
    const { data } = (await list.json()) as { data: Array<Record<string, unknown>> }
    expect(data).toHaveLength(1)
    const agent = data[0]!
    expect(agent.status).toBe('active')
    expect(agent.persona).toBe('care-readonly-agent')
    expect(agent.derived_from).toBe('customer-care-agent')
    expect(agent.scopes).toEqual(['consents:admin', 'audit:read'])
    expect(agent.allow_mutations).toBe(false)
    expect(agent.spend_budget).toBe(0)
    expect(agent.client_id).toMatch(/^agent-/)
    expect(agent.approved_by).toBe('demo:platform-super-admin')
    expect(agent.registered_by).toBe('demo:platform-admin')
  })

  it('binds scopes from the persona — a caller cannot inject scopes (no DCR escalation)', async () => {
    const app = createApp({ idp })
    // Attempt to smuggle a wider scope set in the body; it must be ignored.
    await registerAndApprove(
      app,
      { persona: 'analytics-readonly-agent', display_name: 'Analytics Bot', scopes: ['platform:superadmin', 'consents:admin'] },
      'b'
    )
    const list = await app.request('/back-office/agents', { headers: hdr('platform-admin') })
    const { data } = (await list.json()) as { data: Array<Record<string, unknown>> }
    expect(data[0]!.scopes).toEqual(['platform:analytics:read'])
    expect(data[0]!.scopes).not.toContain('platform:superadmin')
  })

  it('rejects an unknown persona with 400', async () => {
    const app = createApp({ idp })
    const res = await app.request('/back-office/agents:register', {
      method: 'POST',
      headers: hdr('platform-admin', { 'idempotency-key': 'u1' }),
      body: JSON.stringify({ persona: 'bogus-agent', display_name: 'Nope' })
    })
    expect(res.status).toBe(400)
    const { error } = (await res.json()) as { error: { code: string } }
    expect(error.code).toBe('BACKOFFICE.UNKNOWN_AGENT_PERSONA')
  })

  it('revoke is single-actor (NOT four-eyes) — 200 directly, status revoked', async () => {
    const app = createApp({ idp })
    await registerAndApprove(app, { persona: 'care-readonly-agent', display_name: 'Care Bot' }, 'c')
    const list = await app.request('/back-office/agents', { headers: hdr('platform-admin') })
    const agentId = ((await list.json()) as { data: Array<{ agent_id: string }> }).data[0]!.agent_id

    const res = await app.request(`/back-office/agents/${agentId}:revoke`, {
      method: 'POST',
      headers: hdr('platform-admin', { 'idempotency-key': 'rv1' }),
      body: JSON.stringify({ reason: 'rotating the credential now' })
    })
    expect(res.status).toBe(200) // not 202 — granting needs two, removing needs one
    const { data } = (await res.json()) as { data: { status: string; revoke_reason: string } }
    expect(data.status).toBe('revoked')
    expect(data.revoke_reason).toBe('rotating the credential now')
  })

  it('revoke of an unknown agent is 404', async () => {
    const app = createApp({ idp })
    const res = await app.request('/back-office/agents/4d2c2e2a-0000-4000-8000-000000000000:revoke', {
      method: 'POST',
      headers: hdr('platform-admin', { 'idempotency-key': 'rv2' }),
      body: JSON.stringify({ reason: 'no such agent here' })
    })
    expect(res.status).toBe(404)
  })

  it('list/get require platform:agents:read', async () => {
    const app = createApp({ idp })
    const res = await app.request('/back-office/agents', { headers: hdr('finance-analyst') })
    expect(res.status).toBe(403)
  })
})

describe('BACKOFFICE-60 — agent personas are least privilege', () => {
  it('every seeded agent persona is a strict subset of its human persona (SCOPE_MATRIX)', () => {
    for (const persona of Object.values(AGENT_PERSONAS)) {
      expect(isLeastPrivilege(persona), persona.id).toBe(true)
    }
  })

  it('a persona that mirrors its human persona or holds superadmin is rejected', () => {
    const mirror: AgentPersonaDef = {
      id: 'mirror',
      derivedFrom: 'customer-care-agent',
      scopes: [...SCOPE_MATRIX['customer-care-agent']],
      allowMutations: false,
      spendBudget: 0
    }
    expect(isLeastPrivilege(mirror)).toBe(false)
    const superish: AgentPersonaDef = { id: 's', derivedFrom: 'customer-care-agent', scopes: ['platform:superadmin'], allowMutations: false, spendBudget: 0 }
    expect(isLeastPrivilege(superish)).toBe(false)
  })
})
