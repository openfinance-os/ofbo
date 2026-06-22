import type { ShellPrincipal } from './app-shell'
import { visibleModules } from '../lib/nav'
import { PERSONA_GUIDE, SCOPE_DESCRIPTIONS, personaLabel } from '../lib/persona-guide'

/**
 * Profile — "who you're signed in as and what you can do". Reached from the top-bar
 * identity chip. Explains the chosen persona in plain language: its purpose, the modules
 * it can open (the §2 scope-gated nav), and each privilege described in human terms (the
 * raw scope string kept subtly alongside for transparency). Read-only; token-only; no PII.
 */
export function ProfileView({ principal }: { principal: ShellPrincipal }) {
  const guide = PERSONA_GUIDE[principal.persona]
  const modules = visibleModules(principal.scopes, principal.superadmin).filter((m) => m.key !== 'dashboard' && m.key !== 'approvals')
  return (
    <div className="max-w-3xl space-y-6" data-testid="profile-view">
      <header className="flex items-center gap-4">
        <span className="font-symbols text-4xl text-secondary" aria-hidden>
          account_circle
        </span>
        <div>
          <p className="text-xs uppercase tracking-widest text-on-surface-variant">Signed in as</p>
          <h1 className="text-2xl font-semibold text-on-surface" data-testid="profile-role">
            {personaLabel(principal.persona)}
          </h1>
          {guide ? <p className="text-sm text-on-surface-variant">{guide.tagline}</p> : null}
        </div>
      </header>

      <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5" aria-labelledby="profile-modules-heading">
        <h2 id="profile-modules-heading" className="mb-3 text-sm font-bold uppercase tracking-widest text-primary">
          What you can do
        </h2>
        {modules.length === 0 ? (
          <p className="text-sm text-on-surface-variant">This role has no module access in the current scope set.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="profile-modules">
            {modules.map((m) => (
              <li key={m.key}>
                <a href={m.href} className="flex items-center gap-3 rounded-lg border border-outline-variant p-3 hover:bg-surface-container transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <span className="font-symbols text-xl text-secondary" aria-hidden>
                    {m.icon}
                  </span>
                  <span className="text-sm font-semibold text-on-surface">{m.label}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5" aria-labelledby="profile-privileges-heading" data-testid="profile-privileges">
        <h2 id="profile-privileges-heading" className="mb-1 text-sm font-bold uppercase tracking-widest text-primary">
          Your privileges
        </h2>
        <p className="mb-3 text-xs text-on-surface-variant">
          Privileges are granted per role and enforced everywhere (the back office never grants beyond the role).
          {principal.superadmin ? ' This is a super-administrator role with full platform access.' : ''}
        </p>
        <ul className="divide-y divide-outline-variant">
          {principal.scopes.map((s) => (
            <li key={s} className="flex items-baseline justify-between gap-4 py-2">
              <span className="text-sm text-on-surface">{SCOPE_DESCRIPTIONS[s] ?? s}</span>
              <code className="shrink-0 font-mono text-xs text-on-surface-variant">{s}</code>
            </li>
          ))}
        </ul>
      </section>

      <form action="/api/logout" method="post">
        <button
          type="submit"
          data-testid="profile-switch-persona"
          className="rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold text-on-surface hover:bg-surface-container transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Switch persona
        </button>
      </form>
    </div>
  )
}
