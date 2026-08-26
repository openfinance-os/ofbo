import type { ReactNode } from 'react'

/**
 * Persistent non-prod marker (PRD §3.1 / CLAUDE.md hard stop: the demo environment is
 * permanently non-prod, synthetic data only, and must say so on every screen).
 *
 * It ships in TWO placements, because "on every screen" and "never over the content" are both
 * required and one element cannot do both:
 *
 *   DemoMarker — docked in the app shell's STICKY top bar. In normal flow, so it cannot cover
 *     anything, and sticky, so it stays on screen at every scroll position. This is the marker
 *     an operator actually sees, on every authenticated route.
 *   DemoPill — the floating fallback, mounted once in the root layout so the marker rides
 *     surfaces that have no shell: sign-in, global-error, not-found, access-denied. globals.css
 *     hides it wherever the shell is present, so the two never both show.
 *
 * The floating pill used to be the only placement, and it covered whatever sat in the
 * bottom-right corner — 128 of the 140px of the footer's "Production readiness" link on every
 * authenticated route, and live figures on the data-dense consoles. Docking removes the overlap
 * rather than reserving space around it, which is why the shell's compensating gutters went with
 * this change.
 *
 * Both placements are deliberately QUIET: a dot and a short label in the marker colour, with no
 * fill, border, shadow or blur. Presence is the regulatory requirement, not prominence — and a
 * chrome-heavy pill competing with the page was the thing everyone was working around. The full
 * statement rides `aria-label`, so assistive tech announces it in full on every page.
 */

/** One statement, both placements — the hard-stop wording lives here and nowhere else. */
export const DEMO_STATEMENT =
  'Demo environment — synthetic data only. No real PSU data, ever. Open Finance Back Office, non-production.'

function MarkerBody({ tenantLabel }: { tenantLabel?: string }): ReactNode {
  return (
    <>
      <span className="h-1.5 w-1.5 rounded-full bg-demo" aria-hidden />
      DEMO · non-prod
      {tenantLabel ? <span className="text-on-surface-variant" data-testid="demo-banner-tenant">· {tenantLabel}</span> : null}
    </>
  )
}

/** Docked placement — inline in the shell's sticky top bar. Never overlaps content. */
export function DemoMarker({ tenantLabel }: { tenantLabel?: string } = {}) {
  return (
    <span
      role="note"
      aria-label={DEMO_STATEMENT}
      data-testid="demo-marker"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-demo"
    >
      <MarkerBody tenantLabel={tenantLabel} />
    </span>
  )
}

/**
 * Floating placement — for surfaces with no app shell. `pointer-events-none` so it can never
 * intercept a tap on the sign-in or error screens, which have no shell to dock into.
 */
export function DemoPill({ tenantLabel }: { tenantLabel?: string } = {}) {
  return (
    <div
      role="note"
      aria-label={DEMO_STATEMENT}
      data-testid="demo-banner"
      className="pointer-events-none fixed bottom-3 right-3 z-50 inline-flex items-center gap-1.5 text-xs font-medium text-demo"
    >
      <MarkerBody tenantLabel={tenantLabel} />
    </div>
  )
}
