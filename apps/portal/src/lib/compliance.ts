/**
 * UI — Compliance view data layer. Closes the app-shell's Compliance nav item, which
 * UI-01 advertised but no screen backed. Wired to the existing compliance-view analytics
 * endpoint (aggregate counts only, no PSU PII), the same `{ data, meta, freshness }`
 * envelope as the other analytics views, so it reuses the shared getter. Server-side only
 * (Bearer from the httpOnly cookie, never in the browser). compliance:reports:read scope.
 */

import { getAnalyticsView, type AnalyticsApiDeps, type AnalyticsView } from './analytics'

export const COMPLIANCE_VIEW_PATH = '/back-office/analytics/compliance-view'

/** The Compliance view dashboard (compliance:reports:read). */
export function getComplianceView(token: string, deps: AnalyticsApiDeps = {}): Promise<AnalyticsView> {
  return getAnalyticsView(token, COMPLIANCE_VIEW_PATH, deps)
}
