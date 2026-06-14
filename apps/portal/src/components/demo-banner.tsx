/**
 * Persistent DEMO banner — rendered in the root layout so it is present on every
 * screen (PRD §3.1 / CLAUDE.md hard stop: the demo environment is permanently
 * non-prod, synthetic data only, and must say so on every page).
 */
export function DemoBanner() {
  return (
    <div role="alert" aria-label="demo environment" data-testid="demo-banner" className="demo-banner">
      DEMO — synthetic data only. No real PSU data, ever. Open Finance Back Office (non-prod).
    </div>
  )
}
