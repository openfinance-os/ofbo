import { AnalyticsSection } from './analytics-dashboard'
import type { AnalyticsView } from '../lib/analytics'

/**
 * UI-09 — Operations Console, translated from the Stitch "OFBO - Operations Console"
 * screen (project 8050269076066130289). Presentational + server-rendered. The aggregate
 * ops view (-28) folds in SLO observations (-58), scheme-certificate expiry (-66), Ozone
 * connectivity, and active outages — all free-form `{ data, freshness }`, so this reuses
 * the UI-06 generic metric renderer (AnalyticsSection) with the mandatory data-freshness
 * indicator (-40). Token-only (no raw hex/px). Operations scope (platform:operations:read).
 */

export interface OperationsConsoleProps {
  view?: AnalyticsView | null
  error?: string | null
}

export function OperationsConsole({ view, error }: OperationsConsoleProps) {
  return (
    <div className="space-y-6" data-testid="operations-console">
      <h1 className="text-2xl font-semibold">Operations Console</h1>

      {error ? (
        <p className="bg-error-container text-on-error-container text-sm px-4 py-3 rounded-lg" data-testid="operations-error">
          {error}
        </p>
      ) : null}

      {view ? (
        <AnalyticsSection title="Platform Operations" view={view} testid="operations-section" />
      ) : !error ? (
        <p className="text-sm text-on-surface-variant" data-testid="operations-empty">
          The Operations Console is unavailable.
        </p>
      ) : null}
    </div>
  )
}
