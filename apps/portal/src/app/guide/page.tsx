import { AppShell } from '../../components/app-shell'
import { GuideContent } from '../../components/guide-content'
import { shellBadges } from '../../lib/shell'
import { getSession } from '../../lib/session'

/**
 * The introductory guide — "why this back office exists, and why each screen is here".
 * Reachable from the sign-in screen (a newcomer reads it before choosing a role) and
 * from inside the portal via the header "About this screen" overlay. So it renders both
 * ways: standalone (chromeless) when there's no valid session, and inside the app shell
 * when signed in. Dynamic — the shell/badges reflect the live session.
 */
export const dynamic = 'force-dynamic'

export default async function GuidePage() {
  const session = await getSession()

  if (!session) {
    // Newcomer at the front door (or an expired session) — standalone, with a route back to sign-in.
    return (
      <main className="min-h-screen px-4 py-10">
        <GuideContent chromeless />
      </main>
    )
  }

  const badges = await shellBadges(session.token)
  return (
    <AppShell principal={session.principal} badges={badges}>
      <GuideContent />
    </AppShell>
  )
}
