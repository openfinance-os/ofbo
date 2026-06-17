/**
 * UI-09 — Operations Console data layer (BACKOFFICE-28 ops console; BACKOFFICE-58 SLO
 * observability, BACKOFFICE-66 scheme-certificate expiry, Ozone connectivity + active
 * outages all fold INTO the ops-console view data). It is the same `{ data, meta, freshness }`
 * analytics envelope (free-form data + BACKOFFICE-40 freshness), so this reuses the shared
 * analytics getter. Server-side only (Bearer from the httpOnly cookie, never in the browser).
 * platform:operations:read per the §2 persona matrix. Aggregate ops surface — read-only.
 */

import { getAnalyticsView, type AnalyticsApiDeps, type AnalyticsView } from './analytics'

export const OPERATIONS_CONSOLE_PATH = '/back-office/analytics/operations-console'

/** BACKOFFICE-28 — the Operations Console aggregate view (platform:operations:read). */
export function getOperationsConsole(token: string, deps: AnalyticsApiDeps = {}): Promise<AnalyticsView> {
  return getAnalyticsView(token, OPERATIONS_CONSOLE_PATH, deps)
}
