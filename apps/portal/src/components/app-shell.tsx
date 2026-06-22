'use client'

import { useState, type ReactNode } from 'react'
import { visibleModules } from '../lib/nav'
import { SCOPES } from '../lib/scopes'

/**
 * UI-01 — the design-system app shell (translated from the Stitch "OFBO Portal"
 * screen, project 8050269076066130289). A 240px collapsible sidebar with
 * scope-aware nav, a 64px top bar with a persona badge + density toggle + global
 * search slot, and the content slot. Token-only (no raw hex/px); the persona badge
 * absorbs the M1 scope-echo. Every console screen (UI-02..09) renders inside this.
 *
 * UX-10 (ADR 0013 Option 1) — responsive-safe: below `lg` the sidebar is an off-canvas
 * drawer (mobile hamburger + scrim backdrop); on `lg+` it is the in-flow, collapsible rail.
 * The desktop collapse is `lg:`-scoped so the mobile drawer always shows full labels. The
 * top bar wraps; the density toggle is wired (see [data-density] rules in globals.css).
 */

export interface ShellPrincipal {
  subject: string
  persona: string
  scopes: string[]
  superadmin: boolean
}

export function AppShell({ principal, active, badges, children }: { principal: ShellPrincipal; active?: string; badges?: Record<string, number>; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [compact, setCompact] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const modules = visibleModules(principal.scopes, principal.superadmin)
  // UX-08 — the header search is a scope-aware PSU quick-lookup that routes to the Care
  // console (the primary operator entry point). Shown only to consents:admin personas;
  // hidden otherwise (no inert control for personas without a universal lookup).
  const canSearchPsu = principal.superadmin || principal.scopes.includes(SCOPES.consentsAdmin)
  const closeDrawer = () => setDrawerOpen(false)

  return (
    <div className="flex min-h-screen bg-background text-on-surface" data-testid="app-shell" data-density={compact ? 'compact' : 'comfortable'}>
      <a href="#shell-content" className="skip-link" data-testid="skip-link">Skip to main content</a>

      {/* UX-10 — scrim backdrop behind the mobile drawer (below lg only) */}
      {drawerOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          data-testid="drawer-backdrop"
          onClick={closeDrawer}
          className="fixed inset-0 z-40 bg-on-surface/40 lg:hidden"
        />
      ) : null}

      {/* Sidebar (Stitch: w-60 = 240px). Mobile: fixed off-canvas drawer. lg+: sticky rail. */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-60 transition-transform ${drawerOpen ? 'translate-x-0' : '-translate-x-full'} lg:sticky lg:top-0 lg:h-screen lg:z-auto lg:translate-x-0 ${collapsed ? 'lg:w-16' : 'lg:w-60'} shrink-0 bg-surface border-r border-outline-variant flex flex-col py-container-padding`}
        data-testid="sidebar"
        data-collapsed={collapsed ? 'true' : 'false'}
        data-drawer-open={drawerOpen ? 'true' : 'false'}
      >
        <div className="px-container-padding mb-6 flex items-center justify-between">
          <p className="font-bold text-on-surface">
            OFBO<span className={collapsed ? 'lg:hidden' : undefined}> Portal</span>
          </p>
          {/* mobile-only close button inside the drawer */}
          <button type="button" onClick={closeDrawer} data-testid="close-drawer" aria-label="Close navigation" className="lg:hidden font-symbols text-on-surface-variant hover:text-on-surface cursor-pointer">
            close
          </button>
        </div>
        <p className={`px-container-padding -mt-4 mb-6 text-xs text-on-surface-variant ${collapsed ? 'lg:hidden' : ''}`}>Open Finance Infrastructure</p>
        <nav className="flex flex-col gap-1 px-2" aria-label="primary">
          {modules.map((m) => {
            const count = badges?.[m.key] ?? 0
            const countLabel = count > 9 ? '9+' : String(count)
            return (
            <a
              key={m.key}
              href={m.href}
              onClick={closeDrawer}
              data-testid={`nav-${m.key}`}
              aria-current={active === m.key ? 'page' : undefined}
              title={collapsed ? m.label : undefined}
              className={`relative flex items-center gap-3 px-4 py-3 rounded-xl text-sm ${active === m.key ? 'bg-secondary-fixed text-on-secondary-fixed font-semibold' : 'text-on-surface-variant hover:bg-surface-container'}`}
            >
              <span className="font-symbols text-base" aria-hidden>
                {m.icon}
              </span>
              <span className={collapsed ? 'lg:hidden' : undefined}>{m.label}</span>
              {count > 0 ? (
                <>
                  {/* full count chip: mobile + lg-expanded */}
                  <span
                    className={`ml-auto min-w-5 px-1.5 py-0.5 rounded-full bg-error text-on-error text-xs font-bold text-center leading-none ${collapsed ? 'lg:hidden' : ''}`}
                    data-testid={`nav-badge-${m.key}`}
                    aria-label={`${count} pending`}
                  >
                    {countLabel}
                  </span>
                  {/* compact dot: lg-collapsed only */}
                  {collapsed ? (
                    <span className="hidden lg:block absolute top-2 right-2 w-2 h-2 rounded-full bg-error" aria-hidden />
                  ) : null}
                </>
              ) : null}
            </a>
            )
          })}
        </nav>
        <form action="/api/logout" method="post" className="mt-auto px-2">
          <button type="submit" data-testid="switch-persona" title={collapsed ? 'Switch persona' : undefined} className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-on-surface-variant hover:bg-surface-container cursor-pointer">
            <span className="font-symbols text-base" aria-hidden>
              switch_account
            </span>
            <span className={collapsed ? 'lg:hidden' : undefined}>Switch persona</span>
          </button>
        </form>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex flex-wrap justify-between items-center gap-3 px-container-padding min-h-16 py-2 bg-surface-container-lowest border-b border-outline-variant sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            {/* mobile hamburger — opens the drawer (lg: hidden) */}
            <button type="button" onClick={() => setDrawerOpen(true)} data-testid="open-drawer" aria-label="Open navigation" aria-expanded={drawerOpen} className="lg:hidden font-symbols text-on-surface-variant hover:text-on-surface cursor-pointer">
              menu
            </button>
            {/* desktop collapse toggle (lg+ only) */}
            <button type="button" onClick={() => setCollapsed((c) => !c)} data-testid="toggle-sidebar" aria-label="toggle sidebar" className="hidden lg:inline-flex font-symbols text-on-surface-variant hover:text-on-surface cursor-pointer">
              menu
            </button>
            {canSearchPsu ? (
              <form action="/care" method="get" role="search" data-testid="global-search-form" className="flex items-center min-w-0">
                <input type="hidden" name="identifier_type" value="bank_customer_id" />
                <input
                  type="search"
                  name="identifier"
                  placeholder="Find PSU by customer id…"
                  aria-label="Find PSU by bank customer id"
                  data-testid="global-search"
                  className="w-full max-w-xs px-3 py-1 rounded-full bg-surface-container border border-outline-variant text-sm text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </form>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => setCompact((d) => !d)} data-testid="density-toggle" aria-pressed={compact} className="text-xs px-3 py-1 rounded-full border border-outline-variant text-on-surface-variant hover:bg-surface-container cursor-pointer">
              {compact ? 'Compact' : 'Comfortable'}
            </button>
            {/* persona badge — absorbs the M1 scope-echo */}
            <div className="flex items-center gap-2" data-testid="persona-badge">
              <span className="px-2 py-1 rounded-full bg-primary-container text-on-primary-container text-xs font-medium" data-testid="role-badge">
                {principal.persona}
              </span>
              {principal.superadmin ? (
                <span className="px-2 py-1 rounded-full bg-breach text-white text-xs font-semibold" data-testid="superadmin-badge">
                  super-admin
                </span>
              ) : null}
              <span className="text-xs text-on-surface-variant" data-testid="badge-scope-count">
                {principal.scopes.length} scopes
              </span>
            </div>
          </div>
        </header>
        <main id="shell-content" className="flex-1 px-container-padding py-6 min-w-0" data-testid="shell-content">
          <div data-testid="shell-content-inner" className="mx-auto w-full max-w-screen-2xl">
            {children}
          </div>
        </main>
        {/* UIF-02 — status footer (à la the Stitch screens): demo posture + egress + region. */}
        <footer
          data-testid="shell-footer"
          className="flex flex-wrap items-center gap-x-4 gap-y-1 px-container-padding py-2 border-t border-outline-variant bg-surface-container-lowest text-xs text-on-surface-variant"
        >
          <span>DEMO profile · synthetic data only</span>
          <span className="font-mono">OFBO · non-prod</span>
          <span className="ml-auto inline-flex items-center gap-1">
            <span className="font-symbols text-sm" aria-hidden>
              lock
            </span>
            egress via P6 · UAE region
          </span>
        </footer>
      </div>
    </div>
  )
}
