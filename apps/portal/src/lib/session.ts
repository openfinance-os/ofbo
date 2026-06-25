import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { TOKEN_COOKIE } from './cookies'
import { verifyAndMint, type PortalPrincipal } from './portal'

/**
 * Shared portal session resolution. Every authenticated console page repeats the same
 * cookies() → verifyAndMint() → scope-check → redirect dance; centralising it here means
 * the §2 scope gate is one reviewable helper (CLAUDE.md hard stop: scope hygiene is
 * load-bearing — a hand-edited per-page check is exactly the drift this removes).
 *
 * getSession is wrapped in React cache() so the IdP verifyToken round trip resolves at
 * most once per render — the page and any helper that needs the principal share it
 * (the IdP port is hit once per navigation, not per component).
 */

export interface PortalSession {
  token: string
  principal: PortalPrincipal
}

/**
 * Resolve the signed-in session for the current request, or null when there is no session
 * cookie or the token fails IdP verification. Cached per render (deduped IdP verify).
 */
export const getSession = cache(async (): Promise<PortalSession | null> => {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value
  if (!token) return null
  try {
    return { token, principal: await verifyAndMint(token) }
  } catch {
    return null
  }
})

/**
 * Require a signed-in session, optionally holding `scope`:
 *   - string      → that scope is required
 *   - string[]    → any-of (the principal needs at least one)
 *   - null/omitted → any signed-in principal (cross-cutting screens: approvals, profile)
 * Super-admin bypasses the scope check (BACKOFFICE-80 marker). Redirects to sign-in when
 * unauthenticated, and to /access-denied (carrying the module label + required scope, so
 * the denied screen explains itself) when the scope is missing.
 */
export async function requireSession(opts: { scope?: string | readonly string[] | null; module?: string } = {}): Promise<PortalSession> {
  const session = await getSession()
  if (!session) redirect('/')
  const { principal } = session
  const scope = opts.scope ?? null
  if (scope && !principal.superadmin) {
    const required = Array.isArray(scope) ? scope : [scope as string]
    if (!required.some((s) => principal.scopes.includes(s))) {
      const label = required.join(' or ')
      redirect(`/access-denied?module=${encodeURIComponent(opts.module ?? '')}&required=${encodeURIComponent(label)}`)
    }
  }
  return session
}
