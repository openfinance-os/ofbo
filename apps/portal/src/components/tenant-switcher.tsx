import { getTenant, isMultiTenantDemo, PORTAL_TENANTS } from '../lib/tenant'

/**
 * HOST-01 scaffold (ADR 0027 / docs/proposals/multitenant-platform-blueprint.md §6) — the flagged
 * three-tenant demo switcher. Rendered once in the root layout (like the DEMO pill) as a fixed,
 * unobtrusive control pinned bottom-left, clear of the DEMO pill (bottom-right) and the sidebar.
 * Renders NOTHING unless MULTITENANT_DEMO is on, so normal single-tenant builds/tests/E2E never see
 * it. A no-JS server form: each button POSTs its slug to /api/tenant, which sets the cookie the BFF
 * reads as `x-ofbo-tenant`. The active tenant carries the per-tenant brand accent (data-tenant on
 * <html> drives --brand-accent). Zero-PII: tenant slugs/labels are not PII.
 */
export async function TenantSwitcher() {
  if (!isMultiTenantDemo()) return null
  const current = await getTenant()
  return (
    <form
      action="/api/tenant"
      method="post"
      data-testid="switch-tenant"
      aria-label="Switch demo tenant (synthetic, non-prod)"
      className="fixed bottom-3 left-3 z-50 flex items-center gap-1 rounded-full border border-nav-elevated bg-nav/90 px-2 py-1 text-xs shadow-sm backdrop-blur-sm"
    >
      <span className="px-1 font-symbols text-on-nav" aria-hidden>
        apartment
      </span>
      {PORTAL_TENANTS.map((t) => {
        const active = t.slug === current.slug
        return (
          <button
            key={t.slug}
            type="submit"
            name="tenant"
            value={t.slug}
            data-testid={`tenant-option-${t.slug}`}
            aria-pressed={active}
            title={`${t.label} — ${t.kind} (demo tenant)`}
            className={`rounded-full px-2.5 py-1 font-semibold ${active ? 'bg-nav-elevated text-brand border border-brand' : 'text-on-nav hover:bg-nav-elevated hover:text-white border border-transparent'}`}
          >
            {t.short}
          </button>
        )
      })}
    </form>
  )
}
