import type { IdentityProviderPort } from '../../interfaces.js'
import type { TraceContext } from '../../types.js'

/**
 * P2 enterprise adapter — Microsoft Entra ID (Azure AD). The FIRST reference enterprise adapter
 * (ADR 0023): the template the other ports follow. It implements the same IdentityProviderPort the
 * demo simulator does, so it binds the same contract — with two faithful differences the demo can't
 * express (documented in ADR 0023):
 *   • human login is a real OIDC flow (Entra-issued JWT), not the demo persona-picker; and
 *   • the agent session (ADR 0018) is issued by the bank's token service, not the demo HMAC key.
 *
 * The OFBO-specific logic lives HERE and is fully testable: Entra claim → OFBO persona mapping,
 * MANDATORY-MFA enforcement (a hard stop — a non-MFA token is rejected), and the agent-session
 * round-trip. The cryptographic JWT verification (signature/issuer/audience/expiry against Entra's
 * JWKS) is an injected seam — production wires a JWKS-backed RS256 verifier (entraIdpFromEnv builds
 * one with `jose`, loaded lazily); tests inject a fake so they never touch the network.
 */

/** The subset of Entra ID v2 token claims this adapter reads. */
export interface EntraClaims {
  iss?: string
  aud?: string | string[]
  /** Entra object id — the stable, non-reassignable subject (preferred over `sub`). */
  oid?: string
  sub?: string
  exp?: number
  /** Authentication methods. Entra includes 'mfa' once a second factor is satisfied. */
  amr?: string[]
  /** App roles (default persona claim) or group oids, depending on configuration. */
  roles?: string[]
  groups?: string[]
  [claim: string]: unknown
}

/** Cryptographic verification seam. Production: jose createRemoteJWKSet(issuer) + jwtVerify(token,
 *  jwks, { issuer, audience }). MUST throw on an invalid signature / issuer / audience / expiry. */
export type JwtVerifier = (token: string) => Promise<EntraClaims>

/** ADR 0018 — agent session issuance/introspection. Production: the bank auth service (DCR
 *  client-credentials / mTLS, Option 1). The reference HMAC implementation below proves the
 *  round-trip + forgery-rejection contract without a live token service. */
export interface AgentSessionInput {
  agent_id: string
  persona: string
  scopes: string[]
  allow_mutations: boolean
  spend_budget: number
}
export interface AgentSessionClaims extends AgentSessionInput {
  session_id: string
  expires_at: string
}
export interface AgentTokenService {
  issue(input: AgentSessionInput): Promise<{ token: string; session_id: string; expires_at: string }>
  /** null = not an agent token (defer to the human OIDC path); throw = tampered/expired. */
  introspect(token: string): Promise<AgentSessionClaims | null>
}

export interface EntraIdpConfig {
  issuer: string
  clientId: string
  /** Token claim carrying the role/group used to derive the OFBO persona (default 'roles'). */
  personaClaim: string
  /** claim value → OFBO persona key (e.g. an Entra app-role or group oid → 'compliance-officer'). */
  personaMapping: Record<string, string>
  /** Optional friendly names for personaLogins() (documentation only — never used to log in). */
  personaDisplayNames?: Record<string, string>
  verifyJwt: JwtVerifier
  agentTokens: AgentTokenService
  /** Reject a token that does not assert MFA (default true — MFA is a P2 hard stop). */
  requireMfa?: boolean
}

function hasMfa(claims: EntraClaims): boolean {
  return Array.isArray(claims.amr) && claims.amr.includes('mfa')
}

function mapPersona(raw: unknown, mapping: Record<string, string>): string | null {
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw]
  const matched = new Set<string>()
  for (const v of values) {
    const key = String(v)
    // OWN-property + string check: a token role named `constructor`/`toString`/… must NOT resolve
    // to an inherited Object.prototype member (which is truthy) and bypass the reject-if-unmapped
    // hard stop. Only an explicitly-configured string mapping counts.
    const hit = Object.prototype.hasOwnProperty.call(mapping, key) ? mapping[key] : undefined
    if (typeof hit === 'string' && hit) matched.add(hit)
  }
  if (matched.size === 0) return null
  // Fail closed on ambiguity: if a token carries roles mapping to DIFFERENT personas, the chosen
  // privilege would depend on claim ordering. An auth boundary must be deterministic — reject.
  if (matched.size > 1) {
    throw new Error(`P2: token maps to multiple OFBO personas (${[...matched].sort().join(', ')}) — ambiguous, refusing`)
  }
  return [...matched][0]!
}

export class EntraIdentityProviderAdapter implements IdentityProviderPort {
  constructor(private readonly cfg: EntraIdpConfig) {}

  async verifyToken(token: string): Promise<{ subject: string; persona: string; mfa: boolean }> {
    const claims = await this.cfg.verifyJwt(token) // throws on bad signature / iss / aud / exp
    const mfa = hasMfa(claims)
    if ((this.cfg.requireMfa ?? true) && !mfa) {
      throw new Error('P2: Entra token does not assert MFA (amr has no "mfa") — MFA is mandatory')
    }
    const subject = claims.oid ?? claims.sub
    if (!subject) throw new Error('P2: Entra token has no oid/sub subject claim')
    const persona = mapPersona(claims[this.cfg.personaClaim], this.cfg.personaMapping)
    if (!persona) throw new Error(`P2: no OFBO persona mapped from the "${this.cfg.personaClaim}" claim`)
    return { subject, persona, mfa }
  }

  /** Enterprise has no demo persona-picker — login is an OIDC redirect to Entra. This returns the
   *  configured persona mapping for documentation/UX only; demo_token is empty (never a credential). */
  async personaLogins(): Promise<{ persona: string; display_name: string; demo_token: string }[]> {
    const seen = new Set<string>()
    const out: { persona: string; display_name: string; demo_token: string }[] = []
    for (const persona of Object.values(this.cfg.personaMapping)) {
      if (seen.has(persona)) continue
      seen.add(persona)
      out.push({ persona, display_name: this.cfg.personaDisplayNames?.[persona] ?? persona, demo_token: '' })
    }
    return out
  }

  async mintAgentSession(input: AgentSessionInput, _trace: TraceContext) {
    return this.cfg.agentTokens.issue({ ...input, scopes: [...input.scopes] })
  }

  async verifyAgentSession(token: string) {
    const claims = await this.cfg.agentTokens.introspect(token)
    if (!claims) return null
    return {
      agent_id: claims.agent_id,
      persona: claims.persona,
      session_id: claims.session_id,
      scopes: claims.scopes,
      allow_mutations: claims.allow_mutations,
      spend_budget: claims.spend_budget,
      expires_at: claims.expires_at
    }
  }
}

// ─── Reference agent-token service (HMAC) ────────────────────────────────────────────────────
// Same `agent-session.<payload>.<sig>` shape as the simulator so the BFF treats both identically.
// Production replaces this with the bank's token service (ADR 0018 Option 1); the security property
// (a forged/tampered token must not verify) is identical and is asserted by the contract test.

const AGENT_SESSION_PREFIX = 'agent-session.'
const AGENT_SESSION_TTL_MS = 15 * 60_000

const b64url = (bytes: ArrayBuffer | Uint8Array): string =>
  Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url')

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

export function hmacAgentTokenService(signingKey: string): AgentTokenService {
  const key = () =>
    crypto.subtle.importKey('raw', new TextEncoder().encode(signingKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])

  async function sign(body: string): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.sign('HMAC', await key(), new TextEncoder().encode(body)))
  }

  return {
    async issue(input) {
      const session_id = crypto.randomUUID()
      const exp = Date.now() + AGENT_SESSION_TTL_MS
      const expires_at = new Date(exp).toISOString()
      const payload = b64url(new TextEncoder().encode(JSON.stringify({ ...input, session_id, exp })))
      const body = AGENT_SESSION_PREFIX + payload
      const token = `${body}.${b64url(await sign(body))}`
      return { token, session_id, expires_at }
    },
    async introspect(token) {
      if (!token.startsWith(AGENT_SESSION_PREFIX)) return null // human bearer → OIDC path
      const parts = token.split('.')
      if (parts.length !== 3) throw new Error('malformed agent session token')
      const [, payload, sig] = parts as [string, string, string]
      const body = `${AGENT_SESSION_PREFIX}${payload}`
      const expected = await sign(body)
      const provided = new Uint8Array(Buffer.from(sig, 'base64url'))
      if (!constantTimeEqual(provided, expected)) throw new Error('agent session signature mismatch')
      const c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AgentSessionInput & { session_id: string; exp: number }
      if (typeof c.exp !== 'number' || c.exp < Date.now()) throw new Error('agent session expired')
      return {
        agent_id: c.agent_id,
        persona: c.persona,
        session_id: c.session_id,
        scopes: c.scopes,
        allow_mutations: c.allow_mutations,
        spend_budget: c.spend_budget,
        expires_at: new Date(c.exp).toISOString()
      }
    }
  }
}

// ─── Env factory ─────────────────────────────────────────────────────────────────────────────

export class EntraIdpConfigError extends Error {
  constructor(message: string) {
    super(`P2 Entra adapter misconfigured: ${message}`)
    this.name = 'EntraIdpConfigError'
  }
}

/** Lazily build a JWKS-backed RS256 verifier (jose) — imported only when actually used, so the
 *  demo profile (which never constructs this adapter) carries no extra weight. `issuer` is matched
 *  exactly (correct + stricter for a single-tenant app registration). A multi-tenant deployment,
 *  whose tokens carry a per-tenant `{tenantid}` issuer, must instead pass a verifier that validates
 *  the issuer against the tenant pattern — wire that as the injected verifyJwt rather than this one. */
function joseJwksVerifier(issuer: string, clientId: string): JwtVerifier {
  let jwks: unknown
  return async (token: string) => {
    const jose = (await import('jose')) as typeof import('jose')
    jwks ??= jose.createRemoteJWKSet(new URL(`${issuer.replace(/\/$/, '')}/discovery/v2.0/keys`))
    const { payload } = await jose.jwtVerify(token, jwks as Parameters<typeof jose.jwtVerify>[1], { issuer, audience: clientId })
    return payload as EntraClaims
  }
}

/** Construct the Entra adapter from configuration (the registry calls this for DEPLOY_PROFILE=
 *  enterprise). Required: P2_OIDC_ISSUER, P2_OIDC_CLIENT_ID, P2_PERSONA_MAPPING (JSON). Optional:
 *  P2_PERSONA_CLAIM (default 'roles'), P2_AGENT_SIGNING_KEY (a bank-token-service stand-in). */
export function entraIdpFromEnv(env: Record<string, string | undefined>): EntraIdentityProviderAdapter {
  const issuer = env.P2_OIDC_ISSUER
  const clientId = env.P2_OIDC_CLIENT_ID
  if (!issuer) throw new EntraIdpConfigError('P2_OIDC_ISSUER is required (e.g. https://login.microsoftonline.com/<tenant>/v2.0)')
  if (!clientId) throw new EntraIdpConfigError('P2_OIDC_CLIENT_ID is required (the app registration / audience)')

  let parsed: unknown
  try {
    parsed = JSON.parse(env.P2_PERSONA_MAPPING ?? '')
  } catch {
    throw new EntraIdpConfigError('P2_PERSONA_MAPPING must be a JSON object mapping Entra role/group → OFBO persona')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new EntraIdpConfigError('P2_PERSONA_MAPPING must be a JSON object mapping Entra role/group → OFBO persona')
  }
  // Null-prototype, validated string→string — no inherited members, no prototype-pollution surface.
  const personaMapping: Record<string, string> = Object.create(null)
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== 'string' || !v) {
      throw new EntraIdpConfigError('P2_PERSONA_MAPPING values must be non-empty OFBO persona strings')
    }
    personaMapping[k] = v
  }
  if (Object.keys(personaMapping).length === 0) {
    throw new EntraIdpConfigError('P2_PERSONA_MAPPING must contain at least one Entra role/group → OFBO persona entry')
  }

  const signingKey = env.P2_AGENT_SIGNING_KEY
  if (!signingKey) throw new EntraIdpConfigError('P2_AGENT_SIGNING_KEY is required (the agent-session signing key / bank token-service stand-in)')
  if (signingKey.length < 32) {
    throw new EntraIdpConfigError('P2_AGENT_SIGNING_KEY must be ≥32 chars of high-entropy secret')
  }
  // Reject the well-known demo key verbatim — pasting it would make enterprise agent tokens forgeable
  // by anyone who can read the open-source simulator.
  if (signingKey === 'ofbo-demo-agent-session-signing-key-synthetic-non-prod') {
    throw new EntraIdpConfigError('P2_AGENT_SIGNING_KEY must not be the demo simulator key — use a unique production secret')
  }

  return new EntraIdentityProviderAdapter({
    issuer,
    clientId,
    personaClaim: env.P2_PERSONA_CLAIM ?? 'roles',
    personaMapping,
    verifyJwt: joseJwksVerifier(issuer, clientId),
    agentTokens: hmacAgentTokenService(signingKey)
  })
}
