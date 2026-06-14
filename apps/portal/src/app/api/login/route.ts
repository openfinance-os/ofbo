import { NextResponse, type NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { TOKEN_COOKIE } from '../../../lib/cookies'
import { recordSignIn, SignInError, verifyAndMint } from '../../../lib/portal'

/**
 * Sign-in: verify the persona's IdP token (MFA mandatory), mint scopes, emit the
 * High-class sign-in audit event, then set the httpOnly session cookie. A failed
 * sign-in returns to the screen with the reason — never a partial session.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const form = await req.formData()
  const token = String(form.get('token') ?? '')
  const traceId = req.headers.get('x-fapi-interaction-id') ?? randomUUID()

  let principal
  try {
    principal = await verifyAndMint(token)
    await recordSignIn(principal, traceId)
  } catch (e) {
    const reason = e instanceof SignInError ? e.reason : 'invalid_token'
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
