import { NextResponse, type NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { redactingLog, errorFrames } from '@ofbo/bff/telemetry'
import { TOKEN_COOKIE } from '../../../lib/cookies'
import { recordSignIn, SignInError, verifyAndMint } from '../../../lib/portal'

/** The sanctioned operational sink — masks by key and by shape before anything is written. */
const signInLog = redactingLog()

/** A UUID, any version — the shape the header is documented to carry. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Sign-in: verify the persona's IdP token (MFA mandatory), mint scopes, emit the High-class
 * sign-in audit event, then set the httpOnly session cookie. A failed sign-in returns to the
 * screen with the reason — never a partial session, and never a session at all unless the audit
 * write succeeded.
 *
 * NO dependency-injection seam. An earlier cut exported `handleSignIn(req, deps)` so tests could
 * substitute an audit sink; that is a second way into the sign-in path, admitting a substitute IdP
 * and a null audit trail, which is the "no new auth paths" rule. The failure paths are exercised
 * through the real handler instead — an unreachable DATABASE_URL produces a genuine audit failure,
 * and an absent one produces a genuine absent sink.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const form = await req.formData()
  const token = String(form.get('token') ?? '')

  // The trace id is CLIENT-SUPPLIED and it lands somewhere permanent: it is echoed on the response
  // and written to `audit_high_sensitivity`, which is INSERT-only with no deletion path for
  // regulated records. Taken on trust, that is an attacker-controlled string with a one-way trip
  // into the regulated trail — send a PSU identifier as the header and it is there for the
  // five-year retention.
  //
  // So it is validated to the shape it is documented to have, and replaced when it is not one.
  // Replaced rather than REJECTED on purpose: refusing the request would hand any caller a way to
  // break sign-in with a malformed header, and the header is a correlation aid, not a credential.
  const supplied = req.headers.get('x-fapi-interaction-id')
  const traceId = supplied && UUID.test(supplied) ? supplied : randomUUID()

  let principal
  let audited = false
  try {
    principal = await verifyAndMint(token)
    audited = await recordSignIn(principal, traceId)
  } catch (e) {
    // TWO different failures, and telling them apart is the point.
    //
    // A SignInError is the AUTH answer: the token is unknown, MFA was not satisfied, the persona
    // is outside the §2 matrix. Anything else is INFRASTRUCTURE — overwhelmingly the audit write,
    // which is the only I/O on this path and which sign-in deliberately fails closed on, because
    // an unaudited session is worse than a refused one.
    //
    // This used to collapse both into `invalid_token`, so a database outage told every operator
    // their token was bad. On the hosted demo that is exactly what happened: sign-in failed for
    // every persona for minutes at a time while the BFF was healthy and accepting the same token,
    // and the screen blamed the token. Whoever picks that up goes to the IdP and finds nothing
    // wrong, because the fault was an exhausted connection pool.
    const authFailure = e instanceof SignInError
    // Named for what the operator can act on, not for the internal cause — the reason string
    // reaches the sign-in screen, so it must carry no detail of the underlying error.
    const reason = authFailure ? e.reason : 'service_unavailable'
    if (!authFailure) {
      // The cause is genuinely useful and genuinely unsafe to echo, so it goes to the server log
      // correlated by trace id, and never into the redirect.
      //
      // Through the SANCTIONED redacting sink, not a bare console.error. Nothing emitted here is
      // request data today — a class name, a trace id — but the hard stop is a property of the
      // PATH, not of today's field list, and the BFF's structurally identical handler already
      // routes through this same sink. An unredacted second path in request-path code is one the
      // next author inherits with no masking and no lint objection when they add `e.message`.
      signInLog('signin_infrastructure_failure', {
        trace_id: traceId,
        error_name: e instanceof Error ? e.name : typeof e,
        error_frames: errorFrames(e)
      })
    }
    // The trace id rides the FAILURE too, not just the success. CLAUDE.md requires
    // x-fapi-interaction-id propagated end-to-end, and the failure is the response that actually
    // needs it: this handler's whole contribution is that an infrastructure failure is now
    // diagnosable from the server log, and this header is what correlates the screen the operator
    // is looking at with the line that names the cause. Telling them to quote a trace id and then
    // omitting it from the very response that carries the error was the gap.
    const failed = NextResponse.redirect(new URL(`/?error=${reason}`, req.url), 303)
    failed.headers.set('x-fapi-interaction-id', traceId)
    return failed
  }

  // FAIL CLOSED on an unaudited sign-in, not just on a failed audit WRITE. UNCONDITIONALLY.
  //
  // A write that throws already failed the sign-in. The gap was an ABSENT sink: `recordSignIn` had
  // nothing to throw, returned quietly, and a privileged scope-bearing session was minted with no
  // row in the INSERT-only regulated trail.
  //
  // An earlier cut let a deployment opt out of this with an environment flag, to preserve signing
  // in without a database. That was the wrong instinct twice over: it invented a platform-level
  // switch that disables a regulatory hard stop, which "compose, don't invent" forbids outright,
  // and it put deployment-mode branching in application core code. CLAUDE.md states the rule with
  // no exemption — "audit-relevant operations: emit to audit_high_sensitivity" — so there is no
  // exemption here either. Running the portal now requires a database, which is what auditing
  // every sign-in actually costs.
  if (!audited) {
    signInLog('signin_refused_unaudited', {
      trace_id: traceId,
      acting_persona: principal.persona,
      reason: 'no audit sink resolved — refusing to mint a session that leaves no regulated record'
    })
    const refused = NextResponse.redirect(new URL('/?error=service_unavailable', req.url), 303)
    refused.headers.set('x-fapi-interaction-id', traceId)
    return refused
  }

  const res = NextResponse.redirect(new URL('/dashboard', req.url), 303)
  res.cookies.set(TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/'
  })
  res.headers.set('x-fapi-interaction-id', traceId)
  return res
}
