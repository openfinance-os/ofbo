import type { PersonaLogin } from '../lib/portal'

/**
 * Sign-in screen body: one MFA-gated sign-in per §2 persona. Each option posts
 * the persona's IdP demo token to /api/login (native form POST — no client JS,
 * no token in browser-accessible storage). MFA is shown as enforced because the
 * IdP port admits no skip path (BACKOFFICE-47).
 */
export function PersonaLoginList({ personas, error }: { personas: PersonaLogin[]; error?: string }) {
  return (
    <section aria-label="persona sign-in" data-testid="persona-login-list">
      <h1>Sign in to the Internal Portal</h1>
      <p className="mfa-note" data-testid="mfa-note">
        MFA is enforced on every sign-in. Choose a persona to continue.
      </p>
      {error ? (
        <p role="alert" className="signin-error" data-testid="signin-error">
          Sign-in failed: {error}
        </p>
      ) : null}
      <ul className="persona-list">
        {personas.map((p) => (
          <li key={p.persona}>
            <form action="/api/login" method="post">
              <input type="hidden" name="token" value={p.demo_token} />
              <button type="submit" data-testid={`login-${p.persona}`}>
                {p.display_name}
                <span className="persona-id"> ({p.persona})</span>
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  )
}
