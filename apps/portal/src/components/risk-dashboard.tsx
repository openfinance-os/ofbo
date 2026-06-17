import { AnalyticsSection } from './analytics-dashboard'
import type { AnalyticsView } from '../lib/analytics'

/**
 * UI-07 — Risk Management & Anomaly Detection, translated from the Stitch "OFBO - Risk
 * Management & Anomaly Detection" screen (project 8050269076066130289). Presentational +
 * server-rendered. The Risk View (-30) and the proactive Nebras-liability monitor (-36)
 * return the same free-form `{ data, freshness }` analytics envelope, so this reuses the
 * UI-06 generic metric renderer (AnalyticsSection) with the mandatory data-freshness
 * indicator (-40). Consent-pattern anomalies (-37) arrive as Risk signals in the Risk View
 * data. Token-only (no raw hex/px). Narrow Risk scope (risk:read).
 */

export interface RiskDashboardProps {
  riskView?: AnalyticsView | null
  liabilityMonitor?: AnalyticsView | null
  error?: string | null
}

export function RiskDashboard({ riskView, liabilityMonitor, error }: RiskDashboardProps) {
  return (
    <div className="space-y-8" data-testid="risk-dashboard">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Risk Management &amp; Anomaly Detection</h1>
        <span className="px-2 py-0.5 rounded-full bg-breach/10 text-breach text-xs font-bold uppercase tracking-wider">Narrow Risk scope</span>
      </div>

      {error ? (
        <p className="bg-error-container text-on-error-container text-sm px-4 py-3 rounded-lg" data-testid="risk-error">
          {error}
        </p>
      ) : null}

      {riskView ? <AnalyticsSection title="Risk Signals & Anomalies" view={riskView} testid="risk-view-section" /> : null}
      {liabilityMonitor ? <AnalyticsSection title="Nebras Liability Monitor" view={liabilityMonitor} testid="liability-section" /> : null}

      {!riskView && !liabilityMonitor && !error ? (
        <p className="text-sm text-on-surface-variant" data-testid="risk-empty">
          No risk views available.
        </p>
      ) : null}
    </div>
  )
}
