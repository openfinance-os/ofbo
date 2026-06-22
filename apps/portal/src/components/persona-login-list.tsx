import type { PersonaLogin } from '../lib/portal'

/**
 * Sign-in screen body: one MFA-gated sign-in per §2 persona. Each option posts
 * the persona's IdP demo token to /api/login (native form POST — no client JS,
 * no token in browser-accessible storage). MFA is shown as enforced because the
 * IdP port admits no skip path (BACKOFFICE-47).
 */
export function PersonaLoginList({ personas, error }: { personas: PersonaLogin[]; error?: string }) {
  return (
    <section
      aria-label="persona sign-in"
      data-testid="persona-login-list"
      className="w-full max-w-2xl rounded-xl border border-outline-variant bg-surface-container-lowest p-8 shadow-sm"
    >
      <div data-testid="signin-brand" className="mb-6 flex items-baseline gap-2">
        <span className="text-2xl font-bold tracking-tight text-on-surface">OFBO</span>
        <span className="text-sm text-on-surface-variant">Open Finance Back Office</span>
      </div>
      <h1 className="text-xl font-bold text-on-surface">Sign in to the Internal Portal</h1>
      <p className="mfa-note mt-1" data-testid="mfa-note">
        MFA is enforced on every sign-in. Choose a persona to continue.
      </p>
      {error ? (
        <p role="alert" className="signin-error mt-3" data-testid="signin-error">
          Sign-in failed: {error}
        </p>
      ) : null}
      <ul className="persona-list mt-6">
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
