/**
 * BACKOFFICE-59 — persistent TRAINING-environment marker. Mirrors the DemoPill, but renders
 * ONLY in a training deployment (NEXT_PUBLIC_OFBO_TRAINING=true), the portal-side twin of the
 * BFF's OFBO_TRAINING Worker flag (which also marks every response x-ofbo-environment=training).
 * So a Customer Care trainee always knows they are in the training sandbox — separate synthetic
 * data, no production audit, nothing reaches the real scheme.
 *
 * A subtle violet pill pinned bottom-right, sitting ABOVE the DEMO pill (training is also
 * non-prod, so both show) without overlapping it. `pointer-events-none` so it never intercepts
 * a tap; the short visible label stays unobtrusive while the full statement rides aria-label.
 */
export function isTrainingEnvironment(): boolean {
  return process.env.NEXT_PUBLIC_OFBO_TRAINING === 'true'
}

export function TrainingPill() {
  if (!isTrainingEnvironment()) return null
  return (
    <div
      role="note"
      aria-label="Training environment — synthetic practice data only. Actions never affect production data, the production audit trail, or the real scheme."
      data-testid="training-banner"
      className="pointer-events-none fixed bottom-12 right-3 z-50 inline-flex items-center gap-1.5 rounded-full border border-training/30 bg-training/10 px-3 py-1 text-xs font-semibold text-training shadow-sm backdrop-blur-sm"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-training" aria-hidden />
      TRAINING · practice
    </div>
  )
}
