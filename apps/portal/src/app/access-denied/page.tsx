import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AppShell } from '../../components/app-shell'
import { shellBadges } from '../../lib/shell'
import { AccessDenied } from '../../components/ui'
import { TOKEN_COOKIE } from '../../lib/cookies'
import { verifyAndMint } from '../../lib/portal'

/**
 * UX-07 — the scope-denied surface. A persona who deep-links / bookmarks a module outside
 * their §2 scope is sent here (instead of a silent bounce to /dashboard) so the denial is
 * legible and auditable. Rendered inside the shell with a valid session; the page-level
 * scope gates remain the enforcement point.
 */
export const dynamic = 'force-dynamic'

export default async function AccessDeniedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value
  if (!token) redirect('/')
  let principal
  try {
    principal = await verifyAndMint(token)
  } catch {
    redirect('/')
  }

  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const moduleName = one(sp.module) ?? 'this area'
  const requiredScope = one(sp.required) ?? 'a scope your persona does not hold'

  return (
    <AppShell principal={{ subject: principal.subject, persona: principal.persona, scopes: principal.scopes, superadmin: principal.superadmin }} badges={token ? await shellBadges(token) : undefined}>
      <AccessDenied persona={principal.persona} moduleName={moduleName} requiredScope={requiredScope} />
    </AppShell>
  )
}
