import type { ReactNode } from 'react'

/**
 * UIF-01 — the 3–4-up metric row (ADR 0016). Wraps a set of KpiStat cells in one labelled
 * group with a consistent responsive grid, so the executive "metric strip" at the top of
 * the Stitch screens is built the same way everywhere. Token-only (no raw hex/px).
 */

export function StatStrip({
  children,
  'aria-label': ariaLabel
}: {
  children: ReactNode
  'aria-label': string
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="grid grid-cols-2 gap-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm lg:grid-cols-4"
    >
      {children}
    </div>
  )
}
