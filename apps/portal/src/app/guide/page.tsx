import { cookies } from 'next/headers'
import { AppShell } from '../../components/app-shell'
import { GuideContent } from '../../components/guide-content'
import { shellBadges } from '../../lib/shell'
import { TOKEN_COOKIE } from '../../lib/cookies'
import { verifyAndMint } from '../../lib/portal'

/**
 * The introductory guide — "why this back office exists, and why each screen is here".
 * Reachable from the sign-in screen (a newcomer reads it before choosing a role) and
 * from inside the portal via the header "About this screen" overlay. So it renders both
 * ways: standalone (chromeless) when there's no valid session, and inside the app shell
 * when signed in. Dynamic — the shell/badges reflect the live session.
 */
export const dynamic = 'force-dynamic'

export default async function GuidePage() {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value

  let principal
  if (token) {
    try {
      principal = await verifyAndMint(token)
    } catch {
      principal = undefined
    }
  }

  if (!principal || !token) {
    // Newcomer at the front door — standalone, with a route back to sign-in.
    return (
      <main className="min-h-screen px-4 py-10">
        <GuideContent chromeless />
      </main>
    )
  }

  return (
    <AppShell
      principal={{ subject: principal.subject, persona: principal.persona, scopes: principal.scopes, superadmin: principal.superadmin }}
      badges={await shellBadges(token)}
    >
      <GuideContent />
    </AppShell>
  )
}
