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
 */

export interface ShellPrincipal {
  subject: string
  persona: string
  scopes: string[]
  superadmin: boolean
}

export function AppShell({ principal, active, children }: { principal: ShellPrincipal; active?: string; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [compact, setCompact] = useState(false)
  const modules = visibleModules(principal.scopes, principal.superadmin)
  // UX-08 — the header search is a scope-aware PSU quick-lookup that routes to the Care
  // console (the primary operator entry point). Shown only to consents:admin personas;
  // hidden otherwise (no inert control for personas without a universal lookup).
  const canSearchPsu = principal.superadmin || principal.scopes.includes(SCOPES.consentsAdmin)

  return (
    <div className="flex min-h-screen bg-background text-on-surface" data-testid="app-shell" data-density={compact ? 'compact' : 'comfortable'}>
      <a href="#shell-content" className="skip-link" data-testid="skip-link">Skip to main content</a>
      {/* Sidebar (Stitch: w-60 = 240px) */}
      <aside
        className={`${collapsed ? 'w-16' : 'w-60'} shrink-0 sticky top-0 h-screen bg-surface border-r border-outline-variant flex flex-col py-container-padding transition-[width]`}
        data-testid="sidebar"
        data-collapsed={collapsed ? 'true' : 'false'}
      >
        <div className="px-container-padding mb-6">
          <p className="font-bold text-on-surface">{collapsed ? 'OFBO' : 'OFBO Portal'}</p>
          {!collapsed ? <p className="text-xs text-on-surface-variant">Open Finance Infrastructure</p> : null}
        </div>
        <nav className="flex flex-col gap-1 px-2" aria-label="primary">
          {modules.map((m) => (
            <a
              key={m.key}
              href={m.href}
              data-testid={`nav-${m.key}`}
              aria-current={active === m.key ? 'page' : undefined}
              title={collapsed ? m.label : undefined}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm ${active === m.key ? 'bg-secondary-fixed text-on-secondary-fixed font-semibold' : 'text-on-surface-variant hover:bg-surface-container'}`}
            >
              <span className="font-symbols text-base" aria-hidden>
                {m.icon}
              </span>
              {!collapsed ? <span>{m.label}</span> : null}
            </a>
          ))}
        </nav>
        <form action="/api/logout" method="post" className="mt-auto px-2">
          <button type="submit" data-testid="switch-persona" title={collapsed ? 'Switch persona' : undefined} className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-on-surface-variant hover:bg-surface-container cursor-pointer">
            <span className="font-symbols text-base" aria-hidden>
              switch_account
            </span>
            {!collapsed ? <span>Switch persona</span> : null}
          </button>
        </form>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex justify-between items-center px-container-padding h-16 bg-surface-container-lowest border-b border-outline-variant sticky top-0 z-40">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setCollapsed((c) => !c)} data-testid="toggle-sidebar" aria-label="toggle sidebar" className="font-symbols text-on-surface-variant hover:text-on-surface cursor-pointer">
              menu
            </button>
            {canSearchPsu ? (
              <form action="/care" method="get" role="search" data-testid="global-search-form" className="flex items-center">
                <input type="hidden" name="identifier_type" value="bank_customer_id" />
                <input
                  type="search"
                  name="identifier"
                  placeholder="Find PSU by customer id…"
                  aria-label="Find PSU by bank customer id"
                  data-testid="global-search"
                  className="px-3 py-1 rounded-full bg-surface-container border border-outline-variant text-sm text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </form>
            ) : null}
          </div>
          <div className="flex items-center gap-4">
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
          {children}
        </main>
      </div>
    </div>
  )
}
