import type { ReactNode } from 'react'

/**
 * BACKOFFICE-59 — persistent TRAINING-environment marker. Mirrors the DEMO marker in both
 * placements (docked in the shell's sticky top bar, floating everywhere else) and renders ONLY in
 * a training deployment (NEXT_PUBLIC_OFBO_TRAINING=true) — the portal-side twin of the BFF's
 * OFBO_TRAINING Worker flag, which also marks every response x-ofbo-environment=training.
 *
 * So a Customer Care trainee always knows they are in the training sandbox: separate synthetic
 * data, no production audit, nothing reaches the real scheme. Training is also non-prod, so this
 * shows ALONGSIDE the DEMO marker rather than replacing it.
 */

/** One statement, both placements. */
export const TRAINING_STATEMENT =
  'Training environment — synthetic practice data only. Actions never affect production data, the production audit trail, or the real scheme.'

export function isTrainingEnvironment(): boolean {
  return process.env.NEXT_PUBLIC_OFBO_TRAINING === 'true'
}

function MarkerBody(): ReactNode {
  return (
    <>
      <span className="h-1.5 w-1.5 rounded-full bg-training" aria-hidden />
      TRAINING · practice
    </>
  )
}

/** Docked placement — inline in the shell's sticky top bar, beside the DEMO marker. */
export function TrainingMarker() {
  if (!isTrainingEnvironment()) return null
  return (
    <span
      role="note"
      aria-label={TRAINING_STATEMENT}
      data-testid="training-marker"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-training"
    >
      <MarkerBody />
    </span>
  )
}

/** Floating placement — for surfaces with no app shell. Sits above the DEMO pill, not over it. */
export function TrainingPill() {
  if (!isTrainingEnvironment()) return null
  return (
    <div
      role="note"
      aria-label={TRAINING_STATEMENT}
      data-testid="training-banner"
      className="pointer-events-none fixed bottom-9 right-3 z-50 inline-flex items-center gap-1.5 text-xs font-medium text-training"
    >
      <MarkerBody />
    </div>
  )
}
