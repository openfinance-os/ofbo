import { NextResponse, type NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { TOKEN_COOKIE } from '../../../lib/cookies'
import { recordSignIn, SignInError, verifyAndMint, type PortalDeps } from '../../../lib/portal'

/**
 * Sign-in: verify the persona's IdP token (MFA mandatory), mint scopes, emit the
 * High-class sign-in audit event, then set the httpOnly session cookie. A failed
 * sign-in returns to the screen with the reason — never a partial session.
 */
export async function POST(req: NextRequest, deps: PortalDeps = {}): Promise<Response> {
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
      console.error(JSON.stringify({
        message: 'signin_infrastructure_failure',
        trace_id: traceId,
        error_name: e instanceof Error ? e.name : typeof e
      }))
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
