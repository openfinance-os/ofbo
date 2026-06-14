import { NextResponse, type NextRequest } from 'next/server'
import { TOKEN_COOKIE } from '../../../lib/cookies'

/** Sign out: clear the session cookie and return to the sign-in screen. */
export async function POST(req: NextRequest): Promise<Response> {
  const res = NextResponse.redirect(new URL('/', req.url), 303)
  res.cookies.set(TOKEN_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}
