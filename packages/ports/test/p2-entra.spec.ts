import { describe, expect, it } from 'vitest'
import {
  EntraIdentityProviderAdapter,
  entraIdpFromEnv,
  hmacAgentTokenService,
  EntraIdpConfigError,
  type EntraClaims,
  type EntraIdpConfig
} from '../src/adapters/enterprise/p2-entra.js'

const trace = { trace_id: '4d2c2e2a-0000-4000-8000-000000000000' }

// A valid Entra v2 token (post-crypto-verification) for the OF Compliance Officer, MFA satisfied.
const VALID: EntraClaims = {
  iss: 'https://login.microsoftonline.com/tenant/v2.0',
  aud: 'client-123',
  oid: 'entra-oid-abc',
  amr: ['pwd', 'mfa'],
  roles: ['OFBO.Compliance'],
  exp: Math.floor(Date.now() / 1000) + 600
}

function adapter(verifyJwt: EntraIdpConfig['verifyJwt'], over: Partial<EntraIdpConfig> = {}) {
  return new EntraIdentityProviderAdapter({
    issuer: 'https://login.microsoftonline.com/tenant/v2.0',
    clientId: 'client-123',
    personaClaim: 'roles',
    personaMapping: { 'OFBO.Compliance': 'compliance-officer', 'OFBO.SuperAdmin': 'platform-super-admin' },
    personaDisplayNames: { 'compliance-officer': 'OF Compliance Officer' },
    verifyJwt,
    agentTokens: hmacAgentTokenService('test-signing-key-synthetic'),
    ...over
  })
}
const valid = (claims: EntraClaims = VALID) => adapter(async () => claims)

describe('P2 Entra adapter — verifyToken (human OIDC)', () => {
  it('maps an MFA-satisfied Entra token to subject + OFBO persona', async () => {
    const r = await valid().verifyToken('jwt')
    expect(r.subject).toBe('entra-oid-abc') // oid preferred over sub
    expect(r.persona).toBe('compliance-officer')
    expect(r.mfa).toBe(true)
  })

  it('rejects a token that does not assert MFA — MFA is a hard stop', async () => {
    await expect(valid({ ...VALID, amr: ['pwd'] }).verifyToken('jwt')).rejects.toThrow(/MFA/)
  })

  it('rejects a token whose role maps to no OFBO persona', async () => {
    await expect(valid({ ...VALID, roles: ['SomeOtherApp.User'] }).verifyToken('jwt')).rejects.toThrow(/persona/)
  })

  it('rejects a token with no subject claim (oid/sub)', async () => {
    const { oid: _oid, ...noSubject } = VALID
    await expect(valid(noSubject).verifyToken('jwt')).rejects.toThrow(/subject/)
  })

  it('propagates a cryptographic verification failure (bad signature / issuer / audience)', async () => {
    const a = adapter(async () => {
      throw new Error('signature verification failed')
    })
    await expect(a.verifyToken('jwt')).rejects.toThrow(/signature/)
  })

  it('falls back to sub when oid is absent', async () => {
    const { oid: _oid, ...withSub } = VALID
    const r = await valid({ ...withSub, sub: 'entra-sub-xyz' }).verifyToken('jwt')
    expect(r.subject).toBe('entra-sub-xyz')
  })
})

describe('P2 Entra adapter — agent session (ADR 0018)', () => {
  it('mints + verifies an agent session, carrying the bound identity', async () => {
    const a = valid()
    const minted = await a.mintAgentSession(
      { agent_id: 'agent-abc', persona: 'care-readonly-agent', scopes: ['consents:admin', 'audit:read'], allow_mutations: true, spend_budget: 3 },
      trace
    )
    expect(minted.token).toMatch(/^agent-session\./)
    expect(minted.session_id).toBeTruthy()
    expect(new Date(minted.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000)

    const v = await a.verifyAgentSession(minted.token)
    expect(v).not.toBeNull()
    expect(v!.agent_id).toBe('agent-abc')
    expect(v!.persona).toBe('care-readonly-agent')
    expect(v!.session_id).toBe(minted.session_id)
    expect(v!.scopes).toEqual(['consents:admin', 'audit:read'])
    expect(v!.allow_mutations).toBe(true)
    expect(v!.spend_budget).toBe(3)
  })

  it('returns null for a human (non-agent) bearer — the OIDC path handles it', async () => {
    const a = valid()
    expect(await a.verifyAgentSession('eyJ.human.jwt')).toBeNull()
    expect(await a.verifyAgentSession('not-a-token')).toBeNull()
  })

  it('rejects a tampered agent session token (forged identity must not verify)', async () => {
    const a = valid()
    const minted = await a.mintAgentSession(
      { agent_id: 'agent-xyz', persona: 'care-readonly-agent', scopes: ['audit:read'], allow_mutations: false, spend_budget: 0 },
      trace
    )
    const forgedPayload = Buffer.from(
      JSON.stringify({ agent_id: 'agent-xyz', persona: 'care-readonly-agent', session_id: 's', scopes: ['consents:admin'], allow_mutations: true, spend_budget: 9999, exp: Date.now() + 60_000 }),
      'utf8'
    ).toString('base64url')
    const sig = minted.token.split('.')[2]
    await expect(a.verifyAgentSession(`agent-session.${forgedPayload}.${sig}`)).rejects.toThrow()
  })
})

describe('P2 Entra adapter — personaLogins + config', () => {
  it('personaLogins lists the mapped personas with NO usable demo token', async () => {
    const logins = await valid().personaLogins()
    expect(logins.map((l) => l.persona).sort()).toEqual(['compliance-officer', 'platform-super-admin'])
    expect(logins.every((l) => l.demo_token === '')).toBe(true)
    expect(logins.find((l) => l.persona === 'compliance-officer')!.display_name).toBe('OF Compliance Officer')
  })

  it('entraIdpFromEnv throws a clear config error when required env is missing', () => {
    expect(() => entraIdpFromEnv({})).toThrow(EntraIdpConfigError)
    expect(() => entraIdpFromEnv({ P2_OIDC_ISSUER: 'https://x/v2.0' })).toThrow(/CLIENT_ID/)
    expect(() => entraIdpFromEnv({ P2_OIDC_ISSUER: 'https://x/v2.0', P2_OIDC_CLIENT_ID: 'c', P2_PERSONA_MAPPING: 'not json' })).toThrow(/PERSONA_MAPPING/)
  })

  it('entraIdpFromEnv constructs from a complete config', () => {
    const a = entraIdpFromEnv({
      P2_OIDC_ISSUER: 'https://login.microsoftonline.com/tenant/v2.0',
      P2_OIDC_CLIENT_ID: 'client-123',
      P2_PERSONA_MAPPING: JSON.stringify({ 'OFBO.Compliance': 'compliance-officer' }),
      P2_AGENT_SIGNING_KEY: 'synthetic-test-key'
    })
    expect(a).toBeInstanceOf(EntraIdentityProviderAdapter)
  })
})
