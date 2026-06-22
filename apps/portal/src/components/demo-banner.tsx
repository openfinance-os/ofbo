/**
 * Persistent non-prod marker (PRD §3.1 / CLAUDE.md hard stop: the demo environment is
 * permanently non-prod, synthetic data only, and must say so on every screen). Rendered
 * once in the root layout — so it rides every page — as a SUBTLE fixed top pill, replacing
 * the old full-width orange bar. The short visible label keeps it unobtrusive; the full
 * regulatory statement is carried in aria-label/title so assistive tech still announces it.
 */
export function DemoPill() {
  return (
    <div
      role="note"
      aria-label="Demo environment — synthetic data only. No real PSU data, ever. Open Finance Back Office, non-production."
      title="Synthetic data only · no real PSU data, ever · non-production"
      data-testid="demo-banner"
      className="fixed top-2 left-1/2 -translate-x-1/2 z-50 inline-flex items-center gap-1.5 rounded-full border border-demo/30 bg-demo/10 px-3 py-1 text-xs font-semibold text-demo shadow-sm backdrop-blur-sm"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-demo" aria-hidden />
      DEMO · non-prod · synthetic data
    </div>
  )
}
