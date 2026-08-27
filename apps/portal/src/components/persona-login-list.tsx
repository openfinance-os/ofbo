import type { PersonaLogin, SignInFailureReason } from '../lib/portal'
import { PERSONA_GUIDE, CAPABILITIES } from '../lib/persona-guide'
import { NAV_MODULES, type NavKey } from '../lib/nav'
import { OfboMark } from './ofbo-mark'
import { BuiltWithHarness } from './built-with-harness'

/**
 * Welcome / persona-selector — the one surface outside the app shell. A two-panel card:
 * a navy "what OFBO is / what it does" explainer (left), and the role chooser (right).
 * Each role is one MFA-gated sign-in that posts the persona's IdP demo token to /api/login
 * (native form POST — no client JS, no token in browser-accessible storage). Each card is
 * enriched with the role's purpose + the modules it can reach (per the §2 scope matrix,
 * presentation-only via PERSONA_GUIDE). MFA is shown enforced (the IdP admits no skip path).
 */
/** Nav key → the label the sidebar uses for it. One source, so a role card and the sidebar cannot
 *  name the same module differently. */
const NAV_LABELS = Object.fromEntries(NAV_MODULES.map((m) => [m.key, m.label])) as Record<NavKey, string>

/**
 * What a failed sign-in tells the person in front of it.
 *
 * The screen used to print the raw reason — "Sign-in failed: invalid_token" — which is both
 * unreadable and, for the infrastructure case, actively misleading: it sent operators to check a
 * token that was fine. Each message now says what happened and what to do about it, and the two
 * causes are genuinely different actions: retry, or pick a different role.
 *
 * An unrecognised reason still falls through to the raw string rather than being swallowed — a
 * new reason must be visible, not silently rendered as a blank alert. But falling through is the
 * LAST line of defence, not the design: the map is keyed on `SignInFailureReason`, the same union
 * the route produces, so adding a reason without a message here is a compile error rather than a
 * slug on screen. The two vocabularies were independent literals before, which is how
 * `service_unavailable` came to be declared twice with nothing tying them together.
 */
const SIGNIN_ERRORS: Record<SignInFailureReason, string> = {
  service_unavailable:
    'Sign-in is temporarily unavailable — the sign-in could not be recorded to the audit trail, so no session was created. Please try again in a moment.',
  invalid_token: 'Sign-in failed: that token was not recognised.',
  mfa_not_satisfied: 'Sign-in failed: multi-factor authentication was not completed.',
  unknown_persona: 'Sign-in failed: that role is not in the scope matrix, so no privileges could be granted.'
}

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
        {/* New-to-Open-Finance route: the introductory guide, reachable before sign-in. */}
        <a
          href="/guide"
          data-testid="welcome-guide-link"
          className="inline-flex items-center gap-2 self-start rounded-lg border border-nav-elevated px-3 py-2 text-sm font-semibold text-white hover:bg-nav-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-active"
        >
          <span className="font-symbols text-base text-nav-active" aria-hidden>
            menu_book
          </span>
          New to Open Finance? Start with the guide
        </a>
        <div className="mt-auto flex flex-col gap-3 border-t border-nav-elevated pt-4">
          <p className="text-xs leading-relaxed text-on-nav opacity-80">
            Every privileged action is four-eyes-gated, scope hygiene is enforced per role, and the environment carries
            zero PII — all egress runs through the secure gateway.
          </p>
          {/* Build provenance — how this back office was produced (the AI build harness). */}
          <BuiltWithHarness />
        </div>
      </div>

      {/* Right — choose a role */}
      <div className="flex flex-col p-8 lg:p-10">
        <h2 className="text-lg font-bold text-on-surface">Choose a role to explore</h2>
        <p className="mfa-note mt-1 text-sm text-on-surface-variant" data-testid="mfa-note">
          MFA is enforced on every sign-in. Pick a persona to enter the portal.
        </p>
        {error ? (
          <p role="alert" className="signin-error mt-3" data-testid="signin-error">
            {/* `error` arrives from the query string, so it is an arbitrary string at runtime — the
                cast narrows it for the lookup only, and the `??` below is what actually handles a
                value outside the union. The map's exhaustive typing is about the PRODUCER side:
                a new reason must gain a message here or the build fails. */}
            {SIGNIN_ERRORS[error as SignInFailureReason] ?? `Sign-in failed: ${error}`}
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
                          {/* The label comes from NAV_MODULES, never retyped here — the card and
                              the sidebar name a module identically because they read one source. */}
                          {g.modules.map((m) => (
                            <span key={m} className="rounded bg-secondary-fixed px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-on-secondary-fixed">
                              {NAV_LABELS[m]}
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
