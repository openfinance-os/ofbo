/**
 * UI-01 — the portal navigation model. Each console module declares the scope
 * required to see it; the app shell hides modules outside the signed-in persona's
 * §2 scope matrix (scope hygiene is load-bearing — never surface a module a persona
 * can't use). Mirrors the Stitch sidebar (Dashboard / Customer Care / Finance /
 * Compliance / Risk / Operations). Icons are Material Symbols (per the Stitch design).
 */

export interface NavModule {
  key: string
  label: string
  href: string
  /** Material Symbols Outlined glyph name. */
  icon: string
  /** Scope required to see the module; null = always visible. */
  scope: string | null
}

export const NAV_MODULES: NavModule[] = [
  { key: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: 'dashboard', scope: null },
  // Four-eyes approvals are cross-cutting (any persona may hold an approver scope); the
  // queue self-filters by approver_required_scope, so the entry is always visible (UI-05).
  { key: 'approvals', label: 'Approvals', href: '/approvals', icon: 'how_to_reg', scope: null },
  { key: 'customer-care', label: 'Customer Care', href: '/care', icon: 'support_agent', scope: 'consents:admin' },
  { key: 'finance', label: 'Finance', href: '/reconciliation', icon: 'account_balance', scope: 'reconciliation:read' },
  { key: 'compliance', label: 'Compliance', href: '/compliance', icon: 'gavel', scope: 'compliance:reports:read' },
  { key: 'risk', label: 'Risk', href: '/risk', icon: 'shield', scope: 'risk:read' },
  { key: 'operations', label: 'Operations', href: '/operations', icon: 'monitoring', scope: 'platform:operations:read' }
]

/**
 * The modules visible to a principal: super-admin sees everything (the marker
 * satisfies any scope, BACKOFFICE-80); otherwise a module shows only when its
 * scope is held (or it has no scope requirement).
 */
export function visibleModules(scopes: readonly string[], superadmin: boolean): NavModule[] {
  if (superadmin) return NAV_MODULES
  return NAV_MODULES.filter((m) => m.scope === null || scopes.includes(m.scope))
}
