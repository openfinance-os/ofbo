import Link from 'next/link'
import { PersonaLoginList } from '../components/persona-login-list'
import { listPersonaLogins } from '../lib/portal'

/** Sign-in screen. Server component — the persona list comes from the P2 IdP
 *  port at request time. Dynamic so the demo always reflects the live adapter. */
export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const personas = await listPersonaLogins()
  const { error } = await searchParams
  // Login is the one surface outside the app shell — centre the branded card both axes.
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 py-10">
      <PersonaLoginList personas={personas} error={error} />
      <div className="flex flex-col items-center gap-1 text-sm text-on-surface-variant" data-testid="readiness-teaser">
        <p>
          New here?{' '}
          <Link href="/demo" className="font-semibold text-secondary hover:underline">
            Watch the 10-minute guided walkthrough →
          </Link>
        </p>
        <p>
          Evaluating OFBO for your bank?{' '}
          <Link href="/readiness" className="font-semibold text-secondary hover:underline">
            See how close you are to production →
          </Link>
        </p>
      </div>
    </main>
  )
}
