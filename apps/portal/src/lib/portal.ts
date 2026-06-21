import { getAdapter, profileFromConfig, type IdentityProviderPort } from '@ofbo/ports'
import { mintScopes } from '@ofbo/bff/auth'
import { PgAuditEmitter, PgAuditReader, type AuditEventSummary, type AuthSinkEvent } from '@ofbo/db'

/**
 * M1-PORTAL-SHELL server library. The portal is the demo-profile BFF first
 * layer (PRD §3.1: "scope enforcement lives in BFF middleware + service layer …
 * the BFF is the first layer"). It does NOT invent an auth path — it composes
 * the SAME primitives the Hono BFF uses: the P2 IdP port (MFA mandatory), the
 * canonical §2 scope matrix via mintScopes, and the High-class audit write path.
 * Every dependency is injectable so the shell is unit-testable without a DB or
 * the Next runtime.
 */

/** Tenancy stamp for the demo profile — mirrors the BFF worker (BD-14). */
export const TENANCY = {
  bankId: process.env.BANK_ID ?? '11111111-1111-4111-8111-111111111111',
  channel: 'internal_retail'
} as const

export interface PersonaLogin {
  persona: string
  display_name: string
  demo_token: string
}

export interface PortalPrincipal {
  subject: string
  persona: string
  scopes: string[]
  superadmin: boolean
}

export interface AuditSink {
  record(event: AuthSinkEvent): Promise<void>
}

export interface AuditSource {
  recent(opts: { actingPrincipal?: string; limit?: number; excludeEventTypes?: string[] }): Promise<AuditEventSummary[]>
}

/**
 * DEMO-01 — low-signal event types the Dashboard "my recent actions" panel drops so
 * operational events (revokes, disputes, refunds) stay visible in its short window.
 * These remain fully visible in the global /audit screen; only the self-scoped panel filters.
 */
export const DASHBOARD_AUDIT_NOISE = ['signin_success', 'scope_denied', 'audit_trail_accessed'] as const

export interface PortalDeps {
  idp?: IdentityProviderPort
  /** `undefined` → resolve from DATABASE_URL; `null` → no audit sink (degraded local dev). */
  auditSink?: AuditSink | null
  auditSource?: AuditSource | null
}

function resolveIdp(deps: PortalDeps): IdentityProviderPort {
  return deps.idp ?? getAdapter('p2-identity-provider', profileFromConfig(process.env))
}

function resolveAuditSink(deps: PortalDeps): AuditSink | null {
  if (deps.auditSink !== undefined) return deps.auditSink
  const url = process.env.DATABASE_URL
  return url ? new PgAuditEmitter(url, TENANCY) : null
}

function resolveAuditSource(deps: PortalDeps): AuditSource | null {
  if (deps.auditSource !== undefined) return deps.auditSource
  const url = process.env.DATABASE_URL
  return url ? new PgAuditReader(url, TENANCY) : null
}

export class SignInError extends Error {
  constructor(public readonly reason: 'invalid_token' | 'mfa_not_satisfied' | 'unknown_persona') {
    super(reason)
    this.name = 'SignInError'
  }
}

/** Persona login options for the sign-in screen (P2 port; pre-auth, read-only). */
export async function listPersonaLogins(deps: PortalDeps = {}): Promise<PersonaLogin[]> {
  return resolveIdp(deps).personaLogins()
}

/**
 * Verify a token through the IdP port and mint admin scopes from the §2 matrix.
 * MFA is mandatory with no skip path (BACKOFFICE-47); an unmatched persona mints
 * zero scopes and is rejected (granting beyond the matrix is an automatic FAIL).
 */
export async function verifyAndMint(token: string, deps: PortalDeps = {}): Promise<PortalPrincipal> {
  const idp = resolveIdp(deps)
  let claims: Awaited<ReturnType<IdentityProviderPort['verifyToken']>>
  try {
    claims = await idp.verifyToken(token)
  } catch {
    throw new SignInError('invalid_token')
  }
  if (!claims.mfa) throw new SignInError('mfa_not_satisfied')
  const scopes = mintScopes(claims.persona)
  if (scopes.length === 0) throw new SignInError('unknown_persona')
  return {
    subject: claims.subject,
    persona: claims.persona,
    scopes,
    superadmin: scopes.includes('platform:superadmin')
  }
}

/**
 * Emit the High-class sign-in audit event. Awaited and propagated — audit is
 * load-bearing for sign-in, exactly as the BFF auth middleware treats it; a
 * failed write fails the sign-in rather than producing an unaudited session.
 */
export async function recordSignIn(principal: PortalPrincipal, traceId: string, deps: PortalDeps = {}): Promise<void> {
  const sink = resolveAuditSink(deps)
  if (!sink) return
  await sink.record({
    event_type: 'signin_success',
    acting_principal: principal.subject,
    acting_persona: principal.persona,
    reason: null,
    trace_id: traceId,
    superadmin_marker: principal.superadmin
  })
}

/** Recent High-class events for this principal — the "audit visible" surface. */
export async function recentAudit(
  principal: PortalPrincipal,
  deps: PortalDeps = {},
  opts: { excludeEventTypes?: readonly string[]; limit?: number } = {}
): Promise<AuditEventSummary[]> {
  const source = resolveAuditSource(deps)
  if (!source) return []
  return source.recent({
    actingPrincipal: principal.subject,
    limit: opts.limit ?? 10,
    ...(opts.excludeEventTypes?.length ? { excludeEventTypes: [...opts.excludeEventTypes] } : {})
  })
}
