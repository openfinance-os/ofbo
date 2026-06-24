// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

/**
 * Regression: the Dashboard's audit read is the only direct-store dependency on the
 * page, and unlike its BFF-backed siblings it used to run un-caught — so a transient
 * audit-store hiccup 500-ed the whole authenticated /dashboard (while the smoke suite,
 * which only exercises the unauthenticated redirect, stayed green). The render must now
 * degrade the AuditPanel to empty instead of taking the page down. The fatal audit path
 * stays at sign-in (an unaudited session is a hard stop) — never here, on render.
 */

const state = vi.hoisted(() => ({ auditRejects: false }))

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'tok' }) }) }))
vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('redirect') } }))

vi.mock('../src/lib/portal.js', () => ({
  DASHBOARD_AUDIT_NOISE: [],
  verifyAndMint: async () => ({ subject: 'demo:super', persona: 'super', scopes: ['*'], superadmin: true }),
  recentAudit: async () => {
    if (state.auditRejects) throw new Error('audit store unreachable')
    return [
      {
        id: 'e1',
        event_type: 'consent_revoked',
        acting_principal: 'demo:super',
        acting_persona: 'super',
        scope_used: 'consent:write',
        request_trace_id: 'trace-1',
        response_status: 200,
        superadmin_marker: true,
        created_at: '2026-06-24T00:00:00.000Z'
      }
    ]
  }
}))

vi.mock('../src/lib/dashboard.js', () => ({
  getDashboardKpis: async () => [],
  getDashboardCharts: async () => ({ reconTrend: [], riskSeverity: [] })
}))
vi.mock('../src/lib/approvals.js', () => ({ listPendingApprovals: async () => ({ approvals: [], next_cursor: null }) }))
vi.mock('../src/lib/shell.js', () => ({ shellBadges: async () => ({}) }))
vi.mock('../src/components/app-shell.js', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('../src/components/dashboard-overview.js', () => ({ DashboardOverview: () => null }))
vi.mock('../src/components/dashboard-charts.js', () => ({ DashboardCharts: () => null }))
vi.mock('../src/components/dashboard-command.js', () => ({ SystemHealthPanel: () => null, FourEyesQueuePanel: () => null }))

import DashboardPage from '../src/app/dashboard/page.js'

afterEach(() => {
  state.auditRejects = false
  cleanup()
})

describe('DashboardPage audit-read resilience', () => {
  it('renders the audit panel rows when the audit read succeeds', async () => {
    state.auditRejects = false
    render(await DashboardPage())
    expect(screen.getByTestId('audit-table')).toBeInTheDocument()
    expect(screen.getByTestId('audit-row')).toHaveAttribute('data-event-type', 'consent_revoked')
  })

  it('degrades to an empty audit panel instead of 500-ing when the audit store is unreachable', async () => {
    state.auditRejects = true
    // The page must resolve, not reject — a thrown audit read would crash the whole dashboard.
    render(await DashboardPage())
    expect(screen.getByTestId('audit-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('audit-table')).not.toBeInTheDocument()
  })
})
