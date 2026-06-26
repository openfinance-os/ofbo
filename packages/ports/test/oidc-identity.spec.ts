import { describe, expect, it, vi } from 'vitest'
import { createOidcIdentityAdapter, oidcIdentityFromEnv, OidcIdentityError } from '../src/adapters/enterprise/oidc-identity.js'

const trace = { trace_id: '4d2c2e2a-0000-4000-8000-000000000000' }

describe('P2 OIDC identity adapter — real path (userinfo, faked transport)', () => {
  it('verifies an MFA-asserted token and maps the group claim → persona', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ sub: 'u-42', groups: ['OFBO-Finance'], amr: ['pwd', 'mfa'] }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
    const adapter = createOidcIdentityAdapter({ issuer: 'https://idp.bank.example', groupToPersona: { 'OFBO-Finance': 'finance-analyst' }, fetchImpl })
    const claims = await adapter.verifyToken('jwt-abc')
    expect(claims).toEqual({ subject: 'u-42', persona: 'finance-analyst', mfa: true })
  })

  it('rejects a token with no MFA assurance claim (mandatory MFA on the Internal Portal)', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ sub: 'u', groups: ['OFBO-Finance'], amr: ['pwd'] }), { status: 200 })) as unknown as typeof fetch
    const adapter = createOidcIdentityAdapter({ issuer: 'https://idp.bank.example', fetchImpl })
    await expect(adapter.verifyToken('jwt')).rejects.toBeInstanceOf(OidcIdentityError)
  })

  it('throws retryable on a 5xx from userinfo', async () => {
    const fetchImpl = vi.fn(async () => new Response('err', { status: 503 })) as unknown as typeof fetch
    const adapter = createOidcIdentityAdapter({ issuer: 'https://idp.bank.example', fetchImpl })
    await expect(adapter.verifyToken('jwt')).rejects.toMatchObject({ retryable: true, status: 503 })
  })
})

describe('P2 OIDC identity adapter — fake path (no issuer / contract context)', () => {
  it('exposes the 9-persona catalogue and round-trips a stub token to MFA-verified claims', async () => {
    const adapter = createOidcIdentityAdapter()
    const personas = await adapter.personaLogins()
    expect(personas).toHaveLength(9)
    expect(personas.map((p) => p.persona)).toEqual(expect.arrayContaining(['platform-super-admin', 'platform-admin']))
    const claims = await adapter.verifyToken(personas[0]!.demo_token)
    expect(claims).toMatchObject({ persona: personas[0]!.persona, mfa: true })
  })

  it('mints + verifies an agent session (ADR 0018 envelope) carrying the bound identity', async () => {
    const adapter = createOidcIdentityAdapter()
    const minted = await adapter.mintAgentSession({ agent_id: 'agent-abc', persona: 'care-readonly-agent', scopes: ['consents:admin', 'audit:read'], allow_mutations: true, spend_budget: 3 }, trace)
    expect(minted.token).toMatch(/^agent-session\./)
    expect(new Date(minted.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000)
    const v = await adapter.verifyAgentSession(minted.token)
    expect(v).toMatchObject({ agent_id: 'agent-abc', session_id: minted.session_id, scopes: ['consents:admin', 'audit:read'], allow_mutations: true, spend_budget: 3 })
  })

  it('returns null for a non-agent bearer and throws on a tampered agent token', async () => {
    const adapter = createOidcIdentityAdapter()
    expect(await adapter.verifyAgentSession('idp-stub:platform-admin')).toBeNull()
    expect(await adapter.verifyAgentSession('not-a-token')).toBeNull()
    const minted = await adapter.mintAgentSession({ agent_id: 'a', persona: 'p', scopes: [], allow_mutations: false, spend_budget: 0 }, trace)
    const forgedPayload = Buffer.from(JSON.stringify({ agent_id: 'a', persona: 'p', session_id: 's', scopes: ['consents:admin'], allow_mutations: true, spend_budget: 9999, exp: Date.now() + 60_000 }), 'utf8').toString('base64url')
    const forged = `agent-session.${forgedPayload}.${minted.token.split('.')[2]}`
    await expect(adapter.verifyAgentSession(forged)).rejects.toBeInstanceOf(OidcIdentityError)
  })

  it('a token minted under one signing key does not verify under another (key-bound)', async () => {
    const a = createOidcIdentityAdapter({ agentSessionKey: 'key-A' })
    const b = createOidcIdentityAdapter({ agentSessionKey: 'key-B' })
    const minted = await a.mintAgentSession({ agent_id: 'a', persona: 'p', scopes: [], allow_mutations: false, spend_budget: 0 }, trace)
    await expect(b.verifyAgentSession(minted.token)).rejects.toBeInstanceOf(OidcIdentityError)
  })

  it('oidcIdentityFromEnv binds the fake path when no OIDC_ISSUER is set', async () => {
    const personas = await oidcIdentityFromEnv({}).personaLogins()
    expect(personas).toHaveLength(9)
  })
})
