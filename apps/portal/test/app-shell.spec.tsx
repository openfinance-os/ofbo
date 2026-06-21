// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { AppShell } from '../src/components/app-shell.js'
import { visibleModules, NAV_MODULES } from '../src/lib/nav.js'

afterEach(cleanup)

/**
 * UI-01 — app shell: scope-aware nav (hides modules outside the §2 matrix), persona
 * badge (absorbs the M1 scope-echo), density toggle, collapsible sidebar.
 */

describe('visibleModules (scope-gated nav)', () => {
  it('shows only the dashboard + in-scope modules for a finance analyst', () => {
    const keys = visibleModules(['reconciliation:read', 'billing:read'], false).map((m) => m.key)
    expect(keys).toContain('dashboard')
    expect(keys).toContain('finance')
    expect(keys).not.toContain('risk')
    expect(keys).not.toContain('customer-care')
    expect(keys).not.toContain('operations')
  })

  it('shows Customer Care for a care agent, Risk for a risk analyst', () => {
    expect(visibleModules(['consents:admin', 'disputes:admin'], false).map((m) => m.key)).toContain('customer-care')
    expect(visibleModules(['risk:read'], false).map((m) => m.key)).toContain('risk')
  })

  it('super-admin sees every module', () => {
    expect(visibleModules([], true)).toHaveLength(NAV_MODULES.length)
  })

  it('the no-scope modules (dashboard + cross-cutting approvals) are always visible', () => {
    expect(visibleModules([], false).map((m) => m.key)).toEqual(['dashboard', 'approvals'])
  })

  it('shows an any-of-scoped module (analytics) to either audience', () => {
    expect(visibleModules(['platform:analytics:read'], false).map((m) => m.key)).toContain('analytics')
    expect(visibleModules(['reconciliation:read'], false).map((m) => m.key)).toContain('analytics')
    expect(visibleModules(['risk:read'], false).map((m) => m.key)).not.toContain('analytics')
  })
})

const finance = { subject: 'demo:finance', persona: 'finance-analyst', scopes: ['reconciliation:read', 'billing:read'], superadmin: false }

describe('AppShell', () => {
  it('renders the scope-aware sidebar + the persona badge (scope echo absorbed), hiding out-of-scope modules', () => {
    render(
      <AppShell principal={finance} active="dashboard">
        <p>content</p>
      </AppShell>
    )
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('nav-finance')).toBeInTheDocument()
    expect(screen.queryByTestId('nav-risk')).not.toBeInTheDocument()
    expect(screen.getByTestId('role-badge')).toHaveTextContent('finance-analyst')
    expect(screen.getByTestId('badge-scope-count')).toHaveTextContent('2 scopes')
    expect(screen.queryByTestId('superadmin-badge')).not.toBeInTheDocument()
    expect(screen.getByTestId('shell-content')).toHaveTextContent('content')
    // the DEMO banner is regulatory — it lives in the root layout, above the shell
  })

  it('marks the active module and shows the super-admin badge for a super admin', () => {
    render(
      <AppShell principal={{ subject: 'demo:sa', persona: 'platform-super-admin', scopes: ['platform:superadmin'], superadmin: true }} active="risk">
        <p>x</p>
      </AppShell>
    )
    expect(screen.getByTestId('superadmin-badge')).toBeInTheDocument()
    expect(screen.getByTestId('nav-risk')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('nav-operations')).toBeInTheDocument() // super-admin sees all
  })

  it('UX-03b: renders a pending-count badge on the Approvals nav item (capped at 9+)', () => {
    const sa = { subject: 'demo:sa', persona: 'platform-super-admin', scopes: ['platform:superadmin'], superadmin: true }
    const { rerender } = render(
      <AppShell principal={sa} badges={{ approvals: 3 }}>
        <p>x</p>
      </AppShell>
    )
    const badge = screen.getByTestId('nav-badge-approvals')
    expect(badge).toHaveTextContent('3')
    expect(badge).toHaveAttribute('aria-label', '3 pending')
    rerender(
      <AppShell principal={sa} badges={{ approvals: 12 }}>
        <p>x</p>
      </AppShell>
    )
    expect(screen.getByTestId('nav-badge-approvals')).toHaveTextContent('9+')
  })

  it('UX-03b: renders no nav badge when there is nothing pending', () => {
    const sa = { subject: 'demo:sa', persona: 'platform-super-admin', scopes: ['platform:superadmin'], superadmin: true }
    render(
      <AppShell principal={sa} badges={{}}>
        <p>x</p>
      </AppShell>
    )
    expect(screen.queryByTestId('nav-badge-approvals')).not.toBeInTheDocument()
  })

  it('UX-08: shows a scope-aware PSU quick-search (→ care) only for a consents:admin persona', () => {
    const care = { subject: 'demo:care', persona: 'care-agent', scopes: ['consents:admin', 'disputes:admin'], superadmin: false }
    render(
      <AppShell principal={care}>
        <p>x</p>
      </AppShell>
    )
    const form = screen.getByTestId('global-search-form')
    expect(form).toHaveAttribute('action', '/care')
    expect(form).toHaveAttribute('role', 'search')
    expect(screen.getByTestId('global-search')).toHaveAttribute('name', 'identifier')
  })

  it('UX-08: hides the global search for a persona without consents:admin (no inert control)', () => {
    render(
      <AppShell principal={finance}>
        <p>x</p>
      </AppShell>
    )
    expect(screen.queryByTestId('global-search')).not.toBeInTheDocument()
  })

  it('toggles density (comfortable ↔ compact) and collapses the sidebar', () => {
    render(
      <AppShell principal={finance}>
        <p>x</p>
      </AppShell>
    )
    const shell = screen.getByTestId('app-shell')
    expect(shell).toHaveAttribute('data-density', 'comfortable')
    fireEvent.click(screen.getByTestId('density-toggle'))
    expect(shell).toHaveAttribute('data-density', 'compact')

    const sidebar = screen.getByTestId('sidebar')
    expect(sidebar).toHaveAttribute('data-collapsed', 'false')
    fireEvent.click(screen.getByTestId('toggle-sidebar'))
    expect(sidebar).toHaveAttribute('data-collapsed', 'true')
  })

  it('UX-10: the mobile hamburger opens the off-canvas drawer; backdrop + close + nav-click close it', () => {
    render(
      <AppShell principal={finance}>
        <p>x</p>
      </AppShell>
    )
    const sidebar = screen.getByTestId('sidebar')
    expect(sidebar).toHaveAttribute('data-drawer-open', 'false')
    expect(screen.queryByTestId('drawer-backdrop')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('open-drawer'))
    expect(sidebar).toHaveAttribute('data-drawer-open', 'true')
    expect(screen.getByTestId('drawer-backdrop')).toBeInTheDocument()

    // backdrop closes it
    fireEvent.click(screen.getByTestId('drawer-backdrop'))
    expect(sidebar).toHaveAttribute('data-drawer-open', 'false')

    // a nav link closes it (mobile: tap-to-navigate dismisses the drawer)
    fireEvent.click(screen.getByTestId('open-drawer'))
    expect(sidebar).toHaveAttribute('data-drawer-open', 'true')
    fireEvent.click(screen.getByTestId('nav-finance'))
    expect(sidebar).toHaveAttribute('data-drawer-open', 'false')
  })
})
