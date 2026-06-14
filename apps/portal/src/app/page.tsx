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
  return <PersonaLoginList personas={personas} error={error} />
}
