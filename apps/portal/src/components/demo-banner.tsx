/**
 * Persistent non-prod marker (PRD §3.1 / CLAUDE.md hard stop: the demo environment is
 * permanently non-prod, synthetic data only, and must say so on every screen). Rendered
 * once in the root layout — so it rides every page — as a SUBTLE pill pinned to the
 * bottom-right corner (clear of the top bar / hamburger / persona chip, which it used to
 * overlap on narrow screens), replacing the old full-width orange bar. It's
 * `pointer-events-none` so it can never intercept a tap even if it visually nears content.
 * The short visible label keeps it unobtrusive; the full regulatory statement is carried in
 * aria-label so assistive tech still announces it (the hard-stop "must say so on every page").
 */
export function DemoPill() {
  return (
    <div
      role="note"
      aria-label="Demo environment — synthetic data only. No real PSU data, ever. Open Finance Back Office, non-production."
      data-testid="demo-banner"
      className="pointer-events-none fixed bottom-3 right-3 z-50 inline-flex items-center gap-1.5 rounded-full border border-demo/30 bg-demo/10 px-3 py-1 text-xs font-semibold text-demo shadow-sm backdrop-blur-sm"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-demo" aria-hidden />
      DEMO · non-prod
    </div>
  )
}
