/**
 * UI-07 — Risk Management & Anomaly Detection data layer (BACKOFFICE-30 Risk View,
 * BACKOFFICE-36 proactive Nebras-liability monitor; the BACKOFFICE-37/-46 consent-pattern
 * anomalies surface AS Risk signals inside the Risk View data). Both views are the same
 * `{ data, meta, freshness }` analytics envelope (free-form data + BACKOFFICE-40 freshness),
 * so this reuses the shared analytics getter. Server-side only (Bearer from the httpOnly
 * cookie, never in the browser). Narrow Risk scope (risk:read) per the §2 persona matrix.
 */

import { getAnalyticsView, type AnalyticsApiDeps, type AnalyticsView } from './analytics'

export const RISK_VIEW_PATH = '/back-office/analytics/risk-view'
export const LIABILITY_MONITOR_PATH = '/back-office/analytics/nebras-liability-monitor'

/** BACKOFFICE-30 — the Risk View dashboard (risk:read): typed risk signals + anomaly feed. */
export function getRiskView(token: string, deps: AnalyticsApiDeps = {}): Promise<AnalyticsView> {
  return getAnalyticsView(token, RISK_VIEW_PATH, deps)
}

/** BACKOFFICE-36 — the proactive Nebras-liability event monitor (risk:read). */
export function getLiabilityMonitor(token: string, deps: AnalyticsApiDeps = {}): Promise<AnalyticsView> {
  return getAnalyticsView(token, LIABILITY_MONITOR_PATH, deps)
}
