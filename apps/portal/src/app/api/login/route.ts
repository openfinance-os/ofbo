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

export async function handleSignIn(req: NextRequest, deps: PortalDeps = {}): Promise<Response> {
  const form = await req.formData()
  const token = String(form.get('token') ?? '')
  const traceId = req.headers.get('x-fapi-interaction-id') ?? randomUUID()

  let principal
  try {
    principal = await verifyAndMint(token, deps)
    await recordSignIn(principal, traceId, deps)
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
    return NextResponse.redirect(new URL(`/?error=${reason}`, req.url), 303)
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
