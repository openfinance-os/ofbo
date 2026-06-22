import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AppShell } from '../../components/app-shell'
import { ProfileView } from '../../components/profile-view'
import { shellBadges } from '../../lib/shell'
import { TOKEN_COOKIE } from '../../lib/cookies'
import { verifyAndMint } from '../../lib/portal'

/**
 * Profile — the signed-in persona and its privileges, in plain language. Server component;
 * the httpOnly token is verified through the IdP port and never reaches the browser.
 */
export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value
  if (!token) redirect('/')
  let principal
  try {
    principal = await verifyAndMint(token)
  } catch {
    redirect('/')
  }
  const shellPrincipal = { subject: principal.subject, persona: principal.persona, scopes: principal.scopes, superadmin: principal.superadmin }
  return (
    <AppShell badges={await shellBadges(token)} principal={shellPrincipal}>
      <ProfileView principal={shellPrincipal} />
    </AppShell>
  )
}
