import { getAdapter, profileFromConfig, type IdentityProviderPort } from '@ofbo/ports'
import { mintScopes } from '@ofbo/bff/auth'
import { redactingLog } from '@ofbo/bff/telemetry'
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

/** The sanctioned operational sink — masks by key and by shape before anything is written. */
const signInLog = redactingLog()

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

/**
 * ONE pool per process, not one per request.
 *
 * `PgAuditEmitter`'s constructor creates a `pg.Pool`, and these resolvers used to call it on every
 * sign-in and every dashboard render. Nothing ever called `close()`, so each request left a pool
 * holding connections open until they idled out, and under any sustained traffic they accumulated
 * until the pooler refused new ones.
 *
 * What that looked like on the hosted demo: sign-in worked, then failed for every persona for
 * several minutes, then recovered — and because `api/login/route.ts` reported any failure as
 * `invalid_token`, it presented as an auth problem rather than an exhausted connection pool.
 * Measured 12/12 succeeding, then 0/12 failing, with the failures returning in ~550ms against
 * ~1700ms for a success: the fast-fail signature of a refused connection, not a slow query.
 *
 * Memoised on the URL so a changed DATABASE_URL still builds a new pool, and so tests that inject
 * `deps` are unaffected. Module scope is the right lifetime here: it is per-isolate in a Worker
 * and per-process locally, which is exactly the scope a connection pool should have.
 */
let cachedSink: { url: string; sink: AuditSink } | undefined
let cachedSource: { url: string; source: AuditSource } | undefined

function resolveAuditSink(deps: PortalDeps): AuditSink | null {
  if (deps.auditSink !== undefined) return deps.auditSink
  const url = process.env.DATABASE_URL
  if (!url) return null
  if (cachedSink?.url !== url) cachedSink = { url, sink: new PgAuditEmitter(url, TENANCY) }
  return cachedSink.sink
}

function resolveAuditSource(deps: PortalDeps): AuditSource | null {
  if (deps.auditSource !== undefined) return deps.auditSource
  const url = process.env.DATABASE_URL
  if (!url) return null
  if (cachedSource?.url !== url) cachedSource = { url, source: new PgAuditReader(url, TENANCY) }
  return cachedSource.source
}

/** Drop the memoised pools — for tests that swap DATABASE_URL between cases. */
export function resetAuditPools(): void {
  cachedSink = undefined
  cachedSource = undefined
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
 * Emit the High-class sign-in audit event. Awaited and propagated — audit is load-bearing for
 * sign-in, exactly as the BFF auth middleware treats it; a failed write fails the sign-in rather
 * than producing an unaudited session.
 *
 * Returns whether the event was actually WRITTEN. A failed write throws and fails the sign-in; an
 * absent sink cannot throw, so it returns false — and the route refuses to mint a session on a
 * false return, unconditionally. That is how the last path to an unaudited session closes, and it
 * is why the portal requires a database to sign anyone in.
 */
/**
 * Emit the High-class sign-in FAILURE event.
 *
 * PRD §9 BACKOFFICE-47 requires it in as many words — "Mandatory MFA on every Internal Portal
 * sign-in … no MFA-skip; failures audited" — and the portal was auditing only successes. A
 * rejected credential is exactly the event a regulator asks about after the fact, and the one an
 * attacker generates in volume; a trail that records who got in but not who was turned away
 * answers neither question.
 *
 * Composes the same sink and the same `signin_failure` event type the BFF's own auth middleware
 * already writes (services/bff/src/auth.ts) — no second audit path, no new event vocabulary.
 *
 * Unlike the success write this does NOT fail the request: the sign-in is already being refused,
 * and turning an audit outage into a different refusal would only change which wrong reason the
 * operator is shown. The failure to audit is announced instead, on the same footing as the
 * missing-sink case above.
 */
export async function recordSignInFailure(
  reason: string,
  traceId: string,
  persona: string | null,
  deps: PortalDeps = {}
): Promise<void> {
  const sink = resolveAuditSink(deps)
  if (!sink) return
  try {
    await sink.record({
      event_type: 'signin_failure',
      // No principal is established — that is what failed. The BFF writes the same 'unknown'
      // placeholder rather than echoing an unverified token or subject back into the trail.
      acting_principal: 'unknown',
      acting_persona: persona,
      reason,
      trace_id: traceId,
      superadmin_marker: false
    })
  } catch (e) {
    signInLog('signin_failure_unaudited', {
      trace_id: traceId,
      reason: 'the sign-in failure could not be written to the audit trail',
      error_name: e instanceof Error ? e.name : typeof e
    })
  }
}

export async function recordSignIn(principal: PortalPrincipal, traceId: string, deps: PortalDeps = {}): Promise<boolean> {
  const sink = resolveAuditSink(deps)
  if (!sink) {
    // An absent sink cannot throw, so it reports instead: there is no audit row, and the caller
    // turns that into a refused sign-in.
    //
    // Announced for EVERY reason it happens, not just the one that looks dangerous. The caller
    // refuses the sign-in either way, so this is not what protects the trail — it is what makes a
    // misconfigured deployment diagnosable instead of merely broken. An operator seeing sign-in
    // fail everywhere needs the reason in the log, which is the same lesson as the rest of this
    // story.
    signInLog('signin_unaudited_no_sink', {
      trace_id: traceId,
      acting_persona: principal.persona,
      reason: deps.auditSink === null
        ? 'the caller injected a null audit sink — the sign-in was NOT written to the audit trail'
        : 'DATABASE_URL is not configured — the sign-in was NOT written to the audit trail'
    })
    return false
  }
  await sink.record({
    event_type: 'signin_success',
    acting_principal: principal.subject,
    acting_persona: principal.persona,
    reason: null,
    trace_id: traceId,
    superadmin_marker: principal.superadmin
  })
  return true
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
