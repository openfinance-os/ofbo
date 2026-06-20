// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { getDashboardKpis } from '../src/lib/dashboard.js'
import { DashboardOverview } from '../src/components/dashboard-overview.js'

afterEach(cleanup)

/** Routes a mock BFF by path. `risk` null → that endpoint 403s (out-of-scope persona). */
function mockFetch(opts: { runs: unknown[]; breaks: unknown[]; pending: unknown[]; risk: unknown[] | null }): typeof fetch {
  return (async (url: string) => {
    const u = String(url)
    const ok = (data: unknown, meta: Record<string, unknown> = {}) => new Response(JSON.stringify({ data, meta }), { status: 200 })
    if (u.includes('/approvals/pending')) return ok(opts.pending)
    if (u.includes('/reconciliation/runs')) return ok(opts.runs, { next_cursor: null })
    if (u.includes('/reconciliation/breaks')) return ok(opts.breaks, { next_cursor: null })
    if (u.includes('/risk-signals')) return opts.risk === null ? new Response(JSON.stringify({ error: { code: 'X' } }), { status: 403 }) : ok(opts.risk)
    return new Response('{}', { status: 404 })
  }) as unknown as typeof fetch
}

const P = { subject: 'demo:super', scopes: ['*'] }
const deps = (fetchImpl: typeof fetch) => ({ baseUrl: 'http://bff.test', fetchImpl })

describe('getDashboardKpis', () => {
  it('composes recon pass-rate, open breaks, pending approvals, and open risk signals', async () => {
    const f = mockFetch({
      runs: [{ line_count_total: 1000, line_count_matched: 992, line_count_unmatched: 8, line_count_disputed: 0 }],
      breaks: [{ status: 'flagged' }, { status: 'assigned' }, { status: 'resolved_matched' }],
      pending: [{ approval_request_id: 'a1' }, { approval_request_id: 'a2' }],
      risk: [{ severity: 'critical' }, { severity: 'medium' }, { severity: 'high' }]
    })
    const kpis = await getDashboardKpis('tok', P, deps(f))
    const by = Object.fromEntries(kpis.map((k) => [k.key, k]))
    expect(by['recon-pass-rate']!.value).toBe('99.2%')
    expect(by['open-breaks']!.value).toBe('2') // flagged + assigned, not resolved
    expect(by['pending-approvals']!.value).toBe('2')
    expect(by['open-risk-signals']!.value).toBe('3')
    expect(by['open-risk-signals']!.sub).toContain('2 high / critical')
    expect(by['open-risk-signals']!.tone).toBe('breach')
  })

  it('gracefully omits a card whose source the persona cannot access (risk 403)', async () => {
    const f = mockFetch({ runs: [], breaks: [], pending: [], risk: null })
    const kpis = await getDashboardKpis('tok', P, deps(f))
    expect(kpis.find((k) => k.key === 'open-risk-signals')).toBeUndefined()
    expect(kpis.find((k) => k.key === 'pending-approvals')).toBeDefined() // approvals still resolves
  })
})

describe('DashboardOverview', () => {
  it('renders a KPI card per metric with the tone + deep-link', () => {
    render(<DashboardOverview kpis={[{ key: 'open-breaks', label: 'Open breaks', value: '5', sub: 'awaiting', tone: 'break', href: '/reconciliation' }]} />)
    const card = screen.getByTestId('kpi-open-breaks')
    expect(card).toHaveTextContent('5')
    expect(card).toHaveTextContent('Open breaks')
    expect(card.closest('a')).toHaveAttribute('href', '/reconciliation')
  })

  it('renders nothing when there are no entitled KPIs', () => {
    render(<DashboardOverview kpis={[]} />)
    expect(screen.queryByTestId('dashboard-overview')).not.toBeInTheDocument()
  })
})
