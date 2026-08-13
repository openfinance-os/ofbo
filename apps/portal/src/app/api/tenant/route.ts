import { NextResponse, type NextRequest } from 'next/server'
import { TENANT_COOKIE } from '../../../lib/cookies'
import { portalTenantBySlug } from '../../../lib/tenant'

/**
 * HOST-01 scaffold (ADR 0028) — switch the demo tenant. A server-side POST (mirrors /api/logout):
 * validates the requested slug against the registry, sets the httpOnly tenant cookie, and returns
 * to the page the user was on (NOT to sign-in — this is a tenant switch, not a logout). An unknown
 * slug is ignored (cookie unchanged). Only meaningful under MULTITENANT_DEMO; harmless otherwise.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const form = await req.formData().catch(() => null)
  const slug = String(form?.get('tenant') ?? '')
  const back = req.headers.get('referer') ?? new URL('/dashboard', req.url).toString()
  const res = NextResponse.redirect(back, 303)
  if (portalTenantBySlug(slug)) {
    res.cookies.set(TENANT_COOKIE, slug, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' })
  }
  return res
}
