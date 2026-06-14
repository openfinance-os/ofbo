import type { PortalPrincipal } from '../lib/portal'

/**
 * Admin-scoped echo (M1 exit criterion): the authenticated principal mirrored
 * back — subject, persona, and the exact admin scopes minted from the §2 matrix.
 * This is the proof that MFA sign-in → scope minting works end to end.
 */
export function ScopeEcho({ principal }: { principal: PortalPrincipal }) {
  return (
    <section aria-label="admin-scoped echo" data-testid="scope-echo">
      <h2>Signed in</h2>
      <dl>
        <dt>Subject</dt>
        <dd data-testid="echo-subject">{principal.subject}</dd>
        <dt>Persona</dt>
        <dd data-testid="echo-persona">{principal.persona}</dd>
        <dt>Super administrator</dt>
        <dd data-testid="echo-superadmin">{principal.superadmin ? 'yes' : 'no'}</dd>
      </dl>
      <h3>Admin scopes</h3>
      <ul className="scope-list" data-testid="echo-scopes">
        {principal.scopes.map((s) => (
          <li key={s} data-scope={s}>
            {s}
          </li>
        ))}
      </ul>
      <form action="/api/logout" method="post">
        <button type="submit" data-testid="logout">
          Sign out
        </button>
      </form>
    </section>
  )
}
