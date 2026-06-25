'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { visibleModules, activeModuleKey } from '../lib/nav'
import { SCOPES } from '../lib/scopes'
import { personaLabel } from '../lib/persona-guide'
import { OfboMark } from './ofbo-mark'
import { ScreenGuideOverlay } from './screen-guide-overlay'

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
 * top bar wraps. (The persona switch is a demo affordance — production signs in via the bank IdP.)
 */

export interface ShellPrincipal {
  subject: string
  persona: string
  scopes: string[]
  superadmin: boolean
}

export function AppShell({ principal, active, badges, children }: { principal: ShellPrincipal; active?: string; badges?: Record<string, number>; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const modules = visibleModules(principal.scopes, principal.superadmin)
  // Active module: an explicit `active` prop wins (kept for tests + any override); otherwise
  // derive it from the URL so pages don't hand-maintain it and nested routes stay highlighted.
  const pathname = usePathname()
  const activeKey = active ?? (pathname ? activeModuleKey(pathname) : undefined)
  // UX-08 — the header search is a scope-aware PSU quick-lookup that routes to the Care
  // console (the primary operator entry point). Shown only to consents:admin personas;
  // hidden otherwise (no inert control for personas without a universal lookup).
  const canSearchPsu = principal.superadmin || principal.scopes.includes(SCOPES.consentsAdmin)
  const closeDrawer = () => setDrawerOpen(false)

  return (
    <div className="flex min-h-screen bg-background text-on-surface" data-testid="app-shell">
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
        className={`fixed inset-y-0 left-0 z-50 w-60 transition-transform ${drawerOpen ? 'translate-x-0' : '-translate-x-full'} lg:sticky lg:top-0 lg:h-screen lg:z-auto lg:translate-x-0 ${collapsed ? 'lg:w-16' : 'lg:w-60'} shrink-0 bg-nav border-r border-nav-elevated flex flex-col py-container-padding`}
        data-testid="sidebar"
        data-collapsed={collapsed ? 'true' : 'false'}
        data-drawer-open={drawerOpen ? 'true' : 'false'}
      >
        <div className={`mb-6 flex items-center justify-between ${collapsed ? 'px-container-padding lg:justify-center lg:px-2' : 'px-container-padding'}`}>
          {/* Brand: a compact monogram tile (fits the 64px collapsed rail) + the wordmark
              when there's room. The wordmark hides on the collapsed lg rail so it can't
              overflow/overlap the rail. */}
          <span className="flex items-center gap-2 font-bold text-white">
            <span aria-hidden className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-nav-elevated">
              <OfboMark className="h-5 w-5" />
            </span>
            <span className={collapsed ? 'lg:hidden' : undefined}>OFBO Portal</span>
            <span className="sr-only">OFBO Portal</span>
          </span>
          {/* mobile-only close button inside the drawer */}
          <button type="button" onClick={closeDrawer} data-testid="close-drawer" aria-label="Close navigation" className="lg:hidden font-symbols text-on-nav hover:text-white cursor-pointer">
            close
          </button>
        </div>
        <p className={`px-container-padding -mt-4 mb-6 text-xs text-on-nav opacity-70 ${collapsed ? 'lg:hidden' : ''}`}>Open Finance Infrastructure</p>
        <nav className="flex flex-col gap-1 px-2" aria-label="primary">
          {modules.map((m) => {
            const count = badges?.[m.key] ?? 0
            const countLabel = count > 9 ? '9+' : String(count)
            return (
            <Link
              key={m.key}
              href={m.href}
              onClick={closeDrawer}
              data-testid={`nav-${m.key}`}
              aria-current={activeKey === m.key ? 'page' : undefined}
              title={collapsed ? m.label : undefined}
              className={`relative flex items-center gap-3 px-4 py-3 rounded-xl text-sm border ${activeKey === m.key ? 'bg-secondary/20 border-secondary/30 text-nav-active font-semibold' : 'border-transparent text-on-nav hover:bg-nav-elevated hover:text-white'}`}
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
            </Link>
            )
          })}
        </nav>
        <form action="/api/logout" method="post" className="mt-auto px-2">
          <button type="submit" data-testid="switch-persona" title={collapsed ? 'Switch role (demo only)' : undefined} className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-on-nav hover:bg-nav-elevated hover:text-white cursor-pointer">
            <span className="font-symbols text-base" aria-hidden>
              swap_horiz
            </span>
            <span className={collapsed ? 'lg:hidden' : undefined}>
              Switch role <span className="text-demo font-semibold">· demo</span>
            </span>
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
            {/* UX — the per-screen "why this exists" overlay (Open Finance context for
                operators new to the scheme). Always present; explains the active module. */}
            <ScreenGuideOverlay activeKey={activeKey} />
            {/* Signed-in identity — friendly "Signed in as <Role>", linking to the profile
                where the persona's privileges are explained (the raw scopes live there, not here). */}
            <a
              href="/profile"
              data-testid="persona-badge"
              aria-label={`Signed in as ${personaLabel(principal.persona)} — view your profile and privileges`}
              className="flex items-center gap-2 rounded-full px-2 py-1 hover:bg-surface-container transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="font-symbols text-lg text-on-surface-variant" aria-hidden>
                account_circle
              </span>
              <span className="text-sm leading-tight">
                <span className="hidden text-xs text-on-surface-variant sm:inline">Signed in as </span>
                <span className="font-semibold text-on-surface" data-testid="role-badge">
                  {personaLabel(principal.persona)}
                </span>
              </span>
              {principal.superadmin ? (
                <span className="px-2 py-0.5 rounded-full bg-breach/10 text-breach text-xs font-semibold" data-testid="superadmin-badge">
                  super-admin
                </span>
              ) : null}
            </a>
          </div>
        </header>
        <main id="shell-content" className="flex-1 px-container-padding py-6 min-w-0" data-testid="shell-content">
          <div data-testid="shell-content-inner" className="mx-auto w-full max-w-screen-2xl">
            {children}
          </div>
        </main>
        {/* UIF-02 — status footer (à la the Stitch screens): demo posture. */}
        <footer
          data-testid="shell-footer"
          className="flex flex-wrap items-center gap-x-4 gap-y-1 px-container-padding py-2 border-t border-outline-variant bg-surface-container-lowest text-xs text-on-surface-variant"
        >
          <span>DEMO profile · synthetic data only</span>
          <span className="font-mono">OFBO · non-prod</span>
        </footer>
      </div>
    </div>
  )
}
