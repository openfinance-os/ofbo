import { AnalyticsSection } from './analytics-dashboard'
import type { AnalyticsView } from '../lib/analytics'

/**
 * Compliance view (presentational + server-rendered). Reuses the generic analytics
 * metric renderer (AnalyticsSection) over the compliance-view data — aggregate counts
 * only, no PSU PII — with the mandatory data-freshness indicator (BACKOFFICE-40).
 * Token-only (no raw hex/px). Compliance scope (compliance:reports:read).
 */

export interface ComplianceViewProps {
  view?: AnalyticsView | null
  error?: string | null
}

export function ComplianceView({ view, error }: ComplianceViewProps) {
  return (
    <div className="space-y-6" data-testid="compliance-view">
      <h1 className="text-2xl font-semibold">Compliance</h1>

      {error ? (
        <p className="bg-error-container text-on-error-container text-sm px-4 py-3 rounded-lg" data-testid="compliance-error">
          {error}
        </p>
      ) : null}

      {view ? (
        <AnalyticsSection title="Compliance Overview" view={view} testid="compliance-section" />
      ) : !error ? (
        <p className="text-sm text-on-surface-variant" data-testid="compliance-empty">
          The Compliance view is unavailable.
        </p>
      ) : null}
    </div>
  )
}
