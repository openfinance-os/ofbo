import { SectionCard, Gauge, ContributionBar } from './ui'
import type { ReconciliationRun } from '../lib/reconciliation'

/**
 * UIF-07 — the Reconciliation Outcome panel (ADR 0016, Stitch 46e55863). Built on the
 * UIF-01/01b primitives and bound to the selected run's live counts (no Stitch mock values):
 * a radial Gauge of the pass rate + a ContributionBar of the matched/unmatched/disputed split.
 * Additive — the existing KPI cards, run list, and break queue are untouched. Token-only.
 *
 * The richer Stitch sections (a true three-way SOURCE-totals table; Margin-by-Fintech;
 * Export/Sign-off) need data the recon contract doesn't expose / the blocked typed-analytics
 * work — split to UIF-07b.
 */

export function ReconOutcomePanel({ run }: { run: ReconciliationRun }) {
  const total = run.line_count_total
  const passRate = total > 0 ? Math.round((run.line_count_matched / total) * 1000) / 10 : 0
  const segments = [
    { label: 'Matched', value: run.line_count_matched },
    { label: 'Unmatched', value: run.line_count_unmatched },
    { label: 'Disputed', value: run.line_count_disputed }
  ]
  return (
    <SectionCard title="Reconciliation Outcome" testid="recon-outcome-panel">
      <div className="grid grid-cols-1 items-center gap-6 p-4 sm:grid-cols-[auto_1fr]">
        <Gauge value={passRate} max={100} unit="%" label="Reconciliation pass rate" />
        <ContributionBar label="Line outcomes" segments={segments} />
      </div>
    </SectionCard>
  )
}
