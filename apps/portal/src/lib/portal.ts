import { getAdapter, profileFromConfig, type IdentityProviderPort } from '@ofbo/ports'
import { mintScopes } from '@ofbo/bff/auth'
import { redactingLog } from '@ofbo/bff/telemetry'
import { PgAuditEmitter, PgAuditReader, type AuditEventSummary, type AuthSinkEvent } from '@ofbo/db'
import { databaseUrl } from './database-url'

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
 * ONE Pg client per request, CLOSED before that request's work returns.
 *
 * Two different defects meet here, and only this lifetime avoids both.
 *
 * The first was a pool built per request and never closed: each one held its connections open
 * until they idled out, and under sustained traffic they accumulated until the pooler refused new
 * ones. On the hosted demo that presented as sign-in working, then failing for every persona for
 * minutes, then recovering — 12/12 succeeding, then 0/12 failing, the failures returning in ~550ms
 * against ~1700ms for a success: the fast-fail signature of a refused connection.
 *
 * The fix for that memoised ONE pool at module scope, reasoning that module scope is per-isolate
 * in a Worker and therefore the right lifetime for a pool. It is the right lifetime for a pool and
 * the wrong one for this runtime. The portal is deployed as a Cloudflare Worker (OpenNext,
 * apps/portal/wrangler.toml), and a Worker may not touch an I/O object created in another
 * request's context — "Cannot perform I/O on behalf of a different request". A `pg.Pool` is
 * exactly that: it keeps sockets alive and hands an idle one back on the next `connect()`. So the
 * first sign-in an isolate served opened a connection and succeeded, and every sign-in after it
 * reused that socket across a request boundary and was refused — sign-in fails closed on an audit
 * write it cannot perform, so the operator got `/?error=service_unavailable` on a healthy
 * deployment, for every persona, until the isolate recycled. The same pool backs the dashboard's
 * audit panel, which silently rendered empty for the same reason.
 *
 * The BFF worker had already written the rule down: "Pg clients are constructed per request and
 * closed after the response — Workers forbid reusing I/O objects across requests"
 * (services/bff/src/worker.ts). This is that rule, applied here rather than restated — construct
 * per unit of work, close in `finally`. Closing is what makes per-request safe this time: the
 * original leak was never the construction, it was that nothing ever handed the connections back.
 *
 * The cost is a connect per audited operation, which is what the BFF pays on every request and
 * what auditing every sign-in costs on this runtime. That connect now goes through the Hyperdrive
 * binding when it is present (./database-url.ts), which pools the far side of it — the fix for the
 * latency, NOT for the correctness: no configuration makes a socket survive a request boundary here.
 */
async function withAuditSink<T>(deps: PortalDeps, fn: (sink: AuditSink | null) => Promise<T>): Promise<T> {
  // An injected sink belongs to its caller: used, never closed. `null` is an explicit "no sink".
  if (deps.auditSink !== undefined) return fn(deps.auditSink)
  const url = databaseUrl()
  if (!url) return fn(null)
  const emitter = new PgAuditEmitter(url, TENANCY)
  try {
    return await fn(emitter)
  } finally {
    // A teardown failure must not rewrite the outcome of the work: the regulated write has either
    // committed or already thrown, and whether the socket came back cleanly changes neither.
    await emitter.close().catch(() => undefined)
  }
}

async function withAuditSource<T>(deps: PortalDeps, fn: (source: AuditSource | null) => Promise<T>): Promise<T> {
  if (deps.auditSource !== undefined) return fn(deps.auditSource)
  const url = databaseUrl()
  if (!url) return fn(null)
  const reader = new PgAuditReader(url, TENANCY)
  try {
    return await fn(reader)
  } finally {
    await reader.close().catch(() => undefined)
  }
}

/**
 * The reason vocabulary the sign-in screen renders — ONE declaration.
 *
 * These strings are produced here and consumed by `persona-login-list.tsx`, which maps each to
 * the sentence an operator reads. When the two were independent literals, adding a reason and
 * forgetting its message was a silent fall-through to the raw slug on screen; typing the message
 * map as `Record<SignInFailureReason, string>` makes that a compile error instead.
 *
 * `service_unavailable` is not a `SignInError` — it is what the route reports when the failure was
 * INFRASTRUCTURE rather than the credential, which is the distinction this story exists to make.
 */
export type SignInAuthReason = 'invalid_token' | 'mfa_not_satisfied' | 'unknown_persona'
export type SignInFailureReason = SignInAuthReason | 'service_unavailable'

/**
 * Every outcome of POST /api/login is a 303 redirect — to the dashboard on success, back to the
 * sign-in screen with a reason on failure. Declared once so the audit rows and the route cannot
 * disagree about what the caller received.
 */
export const SIGN_IN_RESPONSE_STATUS = 303

export class SignInError extends Error {
  /**
   * `persona` is carried when the refusal happened AFTER the token resolved to one — an
   * unsatisfied MFA, a persona outside the §2 matrix. The audit row then names the persona that
   * was turned away instead of the `'unknown'` placeholder, which is what the BFF already records
   * for the identical refusals. An `unknown_persona` refusal is a scope-matrix event; a trail that
   * does not say which persona it was answers nobody's question about it.
   *
   * It stays null for `invalid_token`, where no persona was ever established — echoing an
   * unverified subject into an INSERT-only trail is the thing the placeholder exists to prevent.
   */
  constructor(
    public readonly reason: SignInAuthReason,
    public readonly persona: string | null = null
  ) {
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
  if (!claims.mfa) throw new SignInError('mfa_not_satisfied', claims.persona)
  const scopes = mintScopes(claims.persona)
  if (scopes.length === 0) throw new SignInError('unknown_persona', claims.persona)
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
  // The catch is OUTSIDE the sink, covering building the client as well as writing through it.
  //
  // This function runs inside the route's own `catch` — it is called while a sign-in is already
  // being refused — so anything it throws escapes the handler and turns a 303 back to the sign-in
  // screen into an unhandled 500. The operator would then lose the reason their sign-in was
  // refused BECAUSE the trail was unavailable, which is the failure this function exists to
  // record. Constructing the client is I/O configuration and can fail on its own (a malformed
  // DATABASE_URL), and per-request construction means it is attempted on every refusal rather than
  // once per process, so "the write threw" is no longer the only way this can go wrong.
  try {
    await withAuditSink(deps, async (sink) => {
      if (!sink) return
      await sink.record({
        event_type: 'signin_failure',
        // No principal is established — that is what failed. The BFF writes the same 'unknown'
        // placeholder rather than echoing an unverified token or subject back into the trail.
        acting_principal: 'unknown',
        acting_persona: persona,
        reason,
        trace_id: traceId,
        superadmin_marker: false,
        // The status the BROWSER received, not the one the event type implies. This route answers
        // a form POST with a 303 in every outcome; the emitter's default would stamp 401 on a
        // response no caller ever got, into a trail with no deletion path.
        response_status: SIGN_IN_RESPONSE_STATUS
      })
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
  return withAuditSink(deps, async (sink) => {
    if (!sink) {
      // An absent sink cannot throw, so it reports instead: there is no audit row, and the caller
      // turns that into a refused sign-in.
      //
      // Announced for EVERY reason it happens, not just the one that looks dangerous. The caller
      // refuses the sign-in either way, so this is not what protects the trail — it is what makes
      // a misconfigured deployment diagnosable instead of merely broken. An operator seeing
      // sign-in fail everywhere needs the reason in the log, which is the same lesson as the rest
      // of this story.
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
      superadmin_marker: principal.superadmin,
      // Same reason as the failure path: a successful sign-in is a 303 to /dashboard, not a 200.
      response_status: SIGN_IN_RESPONSE_STATUS
    })
    return true
  })
}

/** Recent High-class events for this principal — the "audit visible" surface. */
export async function recentAudit(
  principal: PortalPrincipal,
  deps: PortalDeps = {},
  opts: { excludeEventTypes?: readonly string[]; limit?: number } = {}
): Promise<AuditEventSummary[]> {
  return withAuditSource(deps, async (source) => {
    if (!source) return []
    return source.recent({
      actingPrincipal: principal.subject,
      limit: opts.limit ?? 10,
      ...(opts.excludeEventTypes?.length ? { excludeEventTypes: [...opts.excludeEventTypes] } : {})
    })
  })
}
