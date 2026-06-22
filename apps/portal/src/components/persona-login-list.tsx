import type { PersonaLogin } from '../lib/portal'
import { PERSONA_GUIDE, CAPABILITIES } from '../lib/persona-guide'
import { OfboMark } from './ofbo-mark'

/**
 * Welcome / persona-selector — the one surface outside the app shell. A two-panel card:
 * a navy "what OFBO is / what it does" explainer (left), and the role chooser (right).
 * Each role is one MFA-gated sign-in that posts the persona's IdP demo token to /api/login
 * (native form POST — no client JS, no token in browser-accessible storage). Each card is
 * enriched with the role's purpose + the modules it can reach (per the §2 scope matrix,
 * presentation-only via PERSONA_GUIDE). MFA is shown enforced (the IdP admits no skip path).
 */
export function PersonaLoginList({ personas, error }: { personas: PersonaLogin[]; error?: string }) {
  return (
    <section
      aria-label="persona sign-in"
      data-testid="persona-login-list"
      className="grid w-full max-w-5xl grid-cols-1 overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-sm lg:grid-cols-2"
    >
      {/* Left — welcome / explainer (navy institutional panel, matching the app shell) */}
      <div className="flex flex-col gap-6 bg-nav p-8 text-on-nav lg:p-10" data-testid="welcome-hero">
        <div data-testid="signin-brand" className="flex items-center gap-2.5">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-nav-elevated" aria-hidden>
            <OfboMark className="h-6 w-6" />
          </span>
          <span className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-white">OFBO</span>
            <span className="text-sm text-on-nav">Open Finance Back Office</span>
          </span>
        </div>
        <div className="space-y-3">
          <h1 className="text-xl font-semibold leading-snug text-white">The bank-neutral back office for UAE Open Finance</h1>
          <p className="text-sm leading-relaxed text-on-nav">
            OFBO is the operations back office a bank runs for its dual role — account-holder (LFI) and TPP-of-record —
            under CBUAE Open Finance (Al&nbsp;Tareq · Nebras). Reconciliation, customer care, risk and analytics in one
            place, vendor-neutral.
          </p>
        </div>
        <div>
          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-on-nav opacity-80">What it does</p>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {CAPABILITIES.map((c) => (
              <li key={c.title} className="flex gap-2.5">
                <span className="font-symbols shrink-0 text-lg text-nav-active" aria-hidden>
                  {c.icon}
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">{c.title}</p>
                  <p className="text-xs leading-snug text-on-nav opacity-80">{c.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-auto border-t border-nav-elevated pt-4 text-xs leading-relaxed text-on-nav opacity-80">
          Every privileged action is four-eyes-gated, scope hygiene is enforced per role, and the environment carries
          zero PII — all egress runs through the secure gateway.
        </p>
      </div>

      {/* Right — choose a role */}
      <div className="flex flex-col p-8 lg:p-10">
        <h2 className="text-lg font-bold text-on-surface">Choose a role to explore</h2>
        <p className="mfa-note mt-1 text-sm text-on-surface-variant" data-testid="mfa-note">
          MFA is enforced on every sign-in. Pick a persona to enter the portal.
        </p>
        {error ? (
          <p role="alert" className="signin-error mt-3" data-testid="signin-error">
            Sign-in failed: {error}
          </p>
        ) : null}
        <ul className="mt-5 space-y-2" data-testid="persona-list">
          {personas.map((p) => {
            const g = PERSONA_GUIDE[p.persona]
            return (
              <li key={p.persona}>
                <form action="/api/login" method="post">
                  <input type="hidden" name="token" value={p.demo_token} />
                  <button
                    type="submit"
                    data-testid={`login-${p.persona}`}
                    className="flex w-full items-start gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-3 text-left transition-colors hover:border-secondary hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-lowest"
                  >
                    <span className="font-symbols mt-0.5 shrink-0 text-xl text-secondary" aria-hidden>
                      {g?.icon ?? 'badge'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-on-surface">{p.display_name}</span>
                      {g ? <span className="block text-xs text-on-surface-variant">{g.tagline}</span> : null}
                      {g ? (
                        <span className="mt-1.5 flex flex-wrap gap-1">
                          {g.modules.map((m) => (
                            <span key={m} className="rounded bg-secondary-fixed px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-on-secondary-fixed">
                              {m}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </span>
                    <span className="font-symbols mt-0.5 shrink-0 text-on-surface-variant" aria-hidden>
                      chevron_right
                    </span>
                  </button>
                </form>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
