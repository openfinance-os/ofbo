import type { IdentityProviderPort } from '../../interfaces.js'

/**
 * P2 — Enterprise IdP (OIDC) adapter (pre-staged per ADR 0023, fidelity rung ③).
 *
 * HONEST NOTE on the contract surface: the P2 port carries some demo-shaped surface
 * (`personaLogins` returns the persona catalogue with a login token — a demo login-screen
 * construct). So this adapter has two clearly separated paths:
 *  - REAL path (issuer configured): `verifyToken` validates an OIDC token via the IdP's
 *    userinfo/introspection endpoint, requires an MFA claim (amr/acr), and maps a group/role
 *    claim → persona via Bank-Profile config. `personaLogins` returns the persona catalogue
 *    with an OIDC auth-init hint (login is an OIDC redirect, not a button token).
 *  - FAKE path (no issuer): mirrors the persona model with synthetic, self-verifiable tokens
 *    so the port contract runs with no IdP (guardrail 4 / rung ②). This is the path the
 *    contract suite exercises.
 *
 * Agent sessions (ADR 0018): minted/verified with an HMAC over the same `agent-session.`
 * envelope the sim uses, keyed by a Bank-Profile signing key — a rung-② stand-in for the
 * M6 enterprise swap to DCR client-credentials / mTLS (Option 1). Implements EXACTLY the P2
 * port contract — nothing more (guardrail 1).
 */

const PERSONAS: readonly (readonly [string, string])[] = [
  ['operations-analyst', 'OF Operations Analyst'],
  ['customer-care-agent', 'Customer Care Agent (OF)'],
  ['compliance-officer', 'OF Compliance Officer'],
  ['finance-analyst', 'OF Finance Analyst'],
  ['risk-analyst', 'OF Risk Analyst'],
  ['commercial-desk-head', 'Commercial Desk Head'],
  ['programme-manager', 'OF Programme Manager'],
  ['platform-admin', 'OF Platform Administrator'],
  ['platform-super-admin', 'Platform Super Administrator']
]

const FAKE_TOKEN_PREFIX = 'idp-stub:'
const AGENT_SESSION_PREFIX = 'agent-session.'
const AGENT_SESSION_TTL_MS = 15 * 60_000

export interface OidcIdentityConfig {
  /** Bank Profile — OIDC issuer base URL. When unset, the fake path is used. */
  issuer?: string
  /** Bank Profile — userinfo/introspection endpoint that returns claims for a bearer
   *  (default `<issuer>/userinfo`). */
  userinfoUrl?: string
  /** Bank Profile — claim carrying the IdP group/role, mapped to an OFBO persona. */
  groupClaim?: string
  /** Bank Profile — IdP group/role → OFBO persona. */
  groupToPersona?: Record<string, string>
  /** Bank Profile — agent-session HMAC signing key (M6 swaps to DCR/mTLS). */
  agentSessionKey?: string
  /** Injectable transport (defaults to global fetch on the real path). */
  fetchImpl?: typeof fetch
}

export class OidcIdentityError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
    message: string
  ) {
    super(message)
    this.name = 'OidcIdentityError'
  }
}

interface AgentSessionClaims {
  agent_id: string
  persona: string
  session_id: string
  scopes: string[]
  allow_mutations: boolean
  spend_budget: number
  exp: number
}

const DEFAULT_AGENT_KEY = 'ofbo-enterprise-agent-session-key-synthetic-non-prod'

const b64url = (bytes: ArrayBuffer | Uint8Array): string =>
  Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url')

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

export function createOidcIdentityAdapter(config: OidcIdentityConfig = {}): IdentityProviderPort {
  const real = Boolean(config.issuer)
  const userinfoUrl = config.userinfoUrl ?? (config.issuer ? `${config.issuer.replace(/\/$/, '')}/userinfo` : undefined)
  const doFetch = config.fetchImpl ?? globalThis.fetch
  const groupClaim = config.groupClaim ?? 'groups'

  const keyPromise = crypto.subtle.importKey('raw', new TextEncoder().encode(config.agentSessionKey ?? DEFAULT_AGENT_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])

  async function sign(body: string): Promise<string> {
    return b64url(await crypto.subtle.sign('HMAC', await keyPromise, new TextEncoder().encode(body)))
  }

  function mapPersona(claims: Record<string, unknown>): string {
    const raw = claims[groupClaim]
    const group = Array.isArray(raw) ? String(raw[0]) : String(raw ?? '')
    return config.groupToPersona?.[group] ?? group
  }

  return {
    async personaLogins() {
      // The persona catalogue is OFBO's real model (PRD §2). On the fake path the token is a
      // self-verifiable stub; on the real path it is an OIDC auth-init hint (login is a redirect).
      return PERSONAS.map(([persona, display_name]) => ({
        persona,
        display_name,
        demo_token: real ? `oidc-init:${persona}` : `${FAKE_TOKEN_PREFIX}${persona}`
      }))
    },

    async verifyToken(token) {
      if (real) {
        if (!userinfoUrl) throw new OidcIdentityError(0, false, 'userinfoUrl/issuer required on the real path')
        const res = await doFetch(userinfoUrl, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } })
        if (!res.ok) throw new OidcIdentityError(res.status, res.status === 429 || res.status >= 500, `OIDC userinfo → ${res.status}`)
        const claims = (await res.json()) as Record<string, unknown>
        const amr = Array.isArray(claims.amr) ? (claims.amr as string[]) : []
        const mfa = amr.includes('mfa') || amr.includes('otp') || amr.includes('hwk') || claims.acr === 'mfa'
        if (!mfa) throw new OidcIdentityError(0, false, 'OIDC token lacks an MFA assurance claim (amr/acr) — mandatory for the Internal Portal')
        return { subject: String(claims.sub ?? ''), persona: mapPersona(claims), mfa: true }
      }
      // Fake path: self-verifiable persona stub.
      if (!token.startsWith(FAKE_TOKEN_PREFIX)) throw new OidcIdentityError(0, false, 'unknown stub token')
      const persona = token.slice(FAKE_TOKEN_PREFIX.length)
      if (!PERSONAS.some(([p]) => p === persona)) throw new OidcIdentityError(0, false, 'unknown persona')
      return { subject: `oidc:${persona}`, persona, mfa: true }
    },

    async mintAgentSession({ agent_id, persona, scopes, allow_mutations, spend_budget }) {
      const session_id = crypto.randomUUID()
      const exp = Date.now() + AGENT_SESSION_TTL_MS
      const claims: AgentSessionClaims = { agent_id, persona, session_id, scopes: [...scopes], allow_mutations, spend_budget, exp }
      const payload = b64url(new TextEncoder().encode(JSON.stringify(claims)))
      const body = AGENT_SESSION_PREFIX + payload
      const token = `${body}.${await sign(body)}`
      return { token, session_id, expires_at: new Date(exp).toISOString() }
    },

    async verifyAgentSession(token) {
      if (!token.startsWith(AGENT_SESSION_PREFIX)) return null // not an agent token → human path handles it
      const parts = token.split('.')
      if (parts.length !== 3) throw new OidcIdentityError(0, false, 'malformed agent session token')
      const [, payload, providedSig] = parts as [string, string, string]
      const expected = new Uint8Array(Buffer.from(await sign(`${AGENT_SESSION_PREFIX}${payload}`), 'base64url'))
      const provided = new Uint8Array(Buffer.from(providedSig, 'base64url'))
      if (!constantTimeEqual(provided, expected)) throw new OidcIdentityError(0, false, 'agent session signature mismatch')
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AgentSessionClaims
      if (typeof claims.exp !== 'number' || claims.exp < Date.now()) throw new OidcIdentityError(0, false, 'agent session expired')
      return {
        agent_id: claims.agent_id,
        persona: claims.persona,
        session_id: claims.session_id,
        scopes: claims.scopes,
        allow_mutations: claims.allow_mutations,
        spend_budget: claims.spend_budget,
        expires_at: new Date(claims.exp).toISOString()
      }
    }
  }
}

export function oidcIdentityFromEnv(env: NodeJS.ProcessEnv = process.env): IdentityProviderPort {
  let groupToPersona: Record<string, string> | undefined
  if (env.OIDC_GROUP_TO_PERSONA) groupToPersona = JSON.parse(env.OIDC_GROUP_TO_PERSONA) as Record<string, string>
  return createOidcIdentityAdapter({
    issuer: env.OIDC_ISSUER,
    userinfoUrl: env.OIDC_USERINFO_URL,
    groupClaim: env.OIDC_GROUP_CLAIM,
    groupToPersona,
    agentSessionKey: env.OIDC_AGENT_SESSION_KEY
  })
}
