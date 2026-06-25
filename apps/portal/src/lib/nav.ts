/**
 * UI-01 — the portal navigation model. Each console module declares the scope
 * required to see it; the app shell hides modules outside the signed-in persona's
 * §2 scope matrix (scope hygiene is load-bearing — never surface a module a persona
 * can't use). Mirrors the Stitch sidebar (Dashboard / Customer Care / Finance /
 * Compliance / Risk / Operations). Icons are Material Symbols (per the Stitch design).
 */

import { SCOPES } from './scopes'

export interface NavModule {
  key: string
  label: string
  href: string
  /** Material Symbols Outlined glyph name. */
  icon: string
  /** Scope(s) required to see the module: a single scope, an any-of list, or null = always visible. */
  scope: string | string[] | null
}

export const NAV_MODULES: NavModule[] = [
  { key: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: 'dashboard', scope: null },
  // Four-eyes approvals are cross-cutting (any persona may hold an approver scope); the
  // queue self-filters by approver_required_scope, so the entry is always visible (UI-05).
  { key: 'approvals', label: 'Approvals', href: '/approvals', icon: 'how_to_reg', scope: null },
  { key: 'customer-care', label: 'Customer Care', href: '/care', icon: 'support_agent', scope: SCOPES.consentsAdmin },
  { key: 'finance', label: 'Finance', href: '/reconciliation', icon: 'account_balance', scope: SCOPES.reconciliationRead },
  // Analytics & Insights binds the Executive Dashboard (platform:analytics:read) + the
  // Finance View (reconciliation:read); visible to either audience (UI-06, any-of).
  { key: 'analytics', label: 'Analytics', href: '/analytics', icon: 'insights', scope: [SCOPES.analyticsRead, SCOPES.reconciliationRead] },
  { key: 'billing', label: 'TPP Billing', href: '/tpp-billing', icon: 'receipt_long', scope: SCOPES.billingRead },
  { key: 'compliance', label: 'Compliance', href: '/compliance', icon: 'gavel', scope: SCOPES.complianceRead },
  { key: 'risk', label: 'Risk', href: '/risk', icon: 'shield', scope: SCOPES.riskRead },
  { key: 'operations', label: 'Operations', href: '/operations', icon: 'monitoring', scope: SCOPES.operationsRead },
  // BACKOFFICE-60 — agent registry (programmatic admin-scope access, ADR 0017); platform-admin persona.
  { key: 'agents', label: 'Agent Registry', href: '/agents', icon: 'smart_toy', scope: SCOPES.agentsRead },
  // DEMO-01 — global audit log (cross-operator "who did X"); the Dashboard panel is self-scoped.
  { key: 'audit', label: 'Audit Log', href: '/audit', icon: 'fact_check', scope: SCOPES.auditRead },
  // The Open Finance onboarding guide — meta/help, NOT a scope-gated capability, so it sits
  // outside the §2 matrix (scope: null = always visible) at the foot of the nav. It explains
  // why each console exists from an Open Finance ecosystem perspective (see lib/screen-guide.ts).
  { key: 'guide', label: 'Guide', href: '/guide', icon: 'menu_book', scope: null }
]

/**
 * The nav key for a pathname — so the shell highlights the active module from the URL
 * (usePathname) instead of every page hand-passing an `active` string that can drift.
 * A module matches its own route or any nested route (e.g. /reconciliation/breaks/x →
 * `finance`, /approvals/:id → `approvals`). The longest matching href wins so a nested
 * route prefers the most specific module. Returns undefined off the nav (e.g. /profile).
 */
export function activeModuleKey(pathname: string): string | undefined {
  const path = ((pathname.split('?')[0] ?? pathname).replace(/\/+$/, '')) || '/'
  const match = [...NAV_MODULES]
    .sort((a, b) => b.href.length - a.href.length)
    .find((m) => path === m.href || path.startsWith(`${m.href}/`))
  return match?.key
}

/**
 * The modules visible to a principal: super-admin sees everything (the marker
 * satisfies any scope, BACKOFFICE-80); otherwise a module shows only when its
 * scope is held (or it has no scope requirement).
 */
export function visibleModules(scopes: readonly string[], superadmin: boolean): NavModule[] {
  if (superadmin) return NAV_MODULES
  return NAV_MODULES.filter((m) => {
    if (m.scope === null) return true
    if (Array.isArray(m.scope)) return m.scope.some((s) => scopes.includes(s))
    return scopes.includes(m.scope)
  })
}
