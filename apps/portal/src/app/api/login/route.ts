import { NextResponse, type NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { redactingLog, errorFrames } from '@ofbo/bff/telemetry'
import { TOKEN_COOKIE } from '../../../lib/cookies'
import { recordSignIn, SignInError, verifyAndMint, type PortalDeps } from '../../../lib/portal'

/** The sanctioned operational sink — masks by key and by shape before anything is written. */
const signInLog = redactingLog()

/**
 * Sign-in: verify the persona's IdP token (MFA mandatory), mint scopes, emit the
 * High-class sign-in audit event, then set the httpOnly session cookie. A failed
 * sign-in returns to the screen with the reason — never a partial session.
 *
 * `handleSignIn` holds the logic and takes its dependencies explicitly; `POST` is the thin Next
 * entry point. Injecting through POST's SECOND parameter would work today and be a trap tomorrow:
 * that position is where Next passes its route context (`{ params }`), so a route that later gains
 * a dynamic segment would silently receive the context as its `deps`.
 */
export async function POST(req: NextRequest): Promise<Response> {
  return handleSignIn(req)
}

/** A UUID, any version — the shape the header is documented to carry. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function handleSignIn(req: NextRequest, deps: PortalDeps = {}): Promise<Response> {
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
    principal = await verifyAndMint(token, deps)
    audited = await recordSignIn(principal, traceId, deps)
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

  // FAIL CLOSED on an unaudited sign-in, not just on a failed audit WRITE.
  //
  // A write that throws already fails the sign-in. The gap was the case where there is no sink to
  // write to at all: `recordSignIn` had nothing to throw, returned quietly, and a privileged
  // scope-bearing session was minted with no row in the INSERT-only regulated trail. CLAUDE.md
  // does not qualify "audit-relevant operations emit to audit_high_sensitivity" by why the sink
  // happens to be missing.
  //
  // Local dev genuinely runs without a database, so that mode is preserved — but as an EXPLICIT
  // opt-in a deployment must set, never as the silent default it was. An environment that simply
  // loses DATABASE_URL now stops issuing sessions instead of issuing untraceable ones.
  if (!audited && process.env.OFBO_ALLOW_UNAUDITED_SIGNIN !== 'true') {
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
