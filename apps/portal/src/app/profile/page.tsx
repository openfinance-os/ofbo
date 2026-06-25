import { AppShell } from '../../components/app-shell'
import { ProfileView } from '../../components/profile-view'
import { shellBadges } from '../../lib/shell'
import { requireSession } from '../../lib/session'

/**
 * Profile — the signed-in persona and its privileges, in plain language. Server component;
 * the httpOnly token is verified through the IdP port and never reaches the browser.
 */
export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
  const { token, principal } = await requireSession()
  const badges = await shellBadges(token)
  return (
    <AppShell badges={badges} principal={principal}>
      <ProfileView principal={principal} />
    </AppShell>
  )
}
