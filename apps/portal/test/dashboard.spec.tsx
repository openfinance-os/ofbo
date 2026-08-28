// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { getDashboardKpis } from '../src/lib/dashboard.js'
import { DashboardOverview } from '../src/components/dashboard-overview.js'
import { getDashboardCharts } from '../src/lib/dashboard.js'

afterEach(cleanup)

/**
 * Routes a mock BFF by path. `risk` null → that endpoint 403s (out-of-scope persona).
 *
 * The envelope is the CONTRACT envelope, not a convenient subset: `meta` carries `request_id` and
 * `timestamp` on every success body and `next_cursor` on every list (spec Envelope; CLAUDE.md
 * §"API conventions"). It used to default `meta` to `{}` for the approvals and risk routes. A
 * fixture weaker than the contract cannot catch a client that starts depending on the parts it
 * omits — which is exactly what happened here: nothing noticed that the risk readers ignored
 * `next_cursor`, because the fixture never sent one.
 *
 * `risk` may be a flat list (one page) or an array of pages, which the route serves in sequence so
 * a cursor-following client can be tested against real continuation.
 */
function mockFetch(opts: {
  runs: unknown[]
  breaks: unknown[]
  pending: unknown[]
  risk: unknown[] | unknown[][] | null
}): typeof fetch {
  const riskPages: unknown[][] | null =
    opts.risk === null ? null : Array.isArray(opts.risk[0]) ? (opts.risk as unknown[][]) : [opts.risk as unknown[]]
  return (async (url: string) => {
    const u = String(url)
    const ok = (data: unknown, meta: Record<string, unknown> = {}) =>
      new Response(
        JSON.stringify({
          data,
          // A UUID because the contract says `format: uuid`, and a real ISO timestamp — the two
          // fields every success body carries.
          meta: { request_id: '3f1a5c8e-0000-4000-8000-000000000001', timestamp: '2026-08-28T00:00:00.000Z', ...meta }
        }),
        { status: 200 }
      )
    if (u.includes('/approvals/pending')) return ok(opts.pending, { next_cursor: null })
    if (u.includes('/reconciliation/runs')) return ok(opts.runs, { next_cursor: null })
    if (u.includes('/reconciliation/breaks')) return ok(opts.breaks, { next_cursor: null })
    if (u.includes('/risk-signals')) {
      if (riskPages === null) return new Response(JSON.stringify({ error: { code: 'X' } }), { status: 403 })
      const cursor = new URL(u, 'http://bff.test').searchParams.get('cursor')
      const index = cursor ? Number(cursor) : 0
      const next = index + 1 < riskPages.length ? String(index + 1) : null
      return ok(riskPages[index] ?? [], { next_cursor: next })
    }
    return new Response('{}', { status: 404 })
  }) as unknown as typeof fetch
}

/** A contract-shaped approval id — `format: uuid` (spec), UUID v4 (CLAUDE.md). */
const approvalId = (n: number) => `a1b2c3d4-0000-4000-8000-00000000000${n}`

const P = { subject: 'demo:super', scopes: ['*'] }
const deps = (fetchImpl: typeof fetch) => ({ baseUrl: 'http://bff.test', fetchImpl })

describe('getDashboardKpis', () => {
  it('composes recon pass-rate, open breaks, pending approvals, and open risk signals', async () => {
    const f = mockFetch({
      runs: [{ line_count_total: 1000, line_count_matched: 992, line_count_unmatched: 8, line_count_disputed: 0 }],
      breaks: [{ status: 'flagged' }, { status: 'assigned' }, { status: 'resolved_matched' }],
      pending: [{ approval_request_id: approvalId(1) }, { approval_request_id: approvalId(2) }],
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

  /**
   * BACKOFFICE-94 — a COUNT is not a STATUS, and the two must not share a colour.
   *
   * `ext.status.aging` is defined in the token set as "open, approaching its clock". Both cards
   * spent it on mere presence: any pending approval, and any open signal of any severity, painted
   * the figure amber. So the demo's first screen showed five approvals sitting comfortably inside
   * their two-hour window (PRD §10) in the colour that means running out of it — and 200
   * info-severity signals in that same amber directly above a caption reading "none
   * high-severity", the colour contradicting the words beneath it.
   *
   * A dashboard that is always amber cannot tell anyone about the day something is genuinely
   * aging, which is the whole job of a status hue.
   */
  it('does not paint a plain count in a status colour', async () => {
    const f = mockFetch({
      runs: [],
      breaks: [],
      pending: [{ approval_request_id: approvalId(1) }, { approval_request_id: approvalId(2) }],
      risk: [{ severity: 'info' }, { severity: 'low' }, { severity: 'medium' }]
    })
    const by = Object.fromEntries((await getDashboardKpis('tok', P, deps(f))).map((k) => [k.key, k]))
    expect(by['pending-approvals']!.value).toBe('2')
    expect(by['pending-approvals']!.tone).toBe('neutral')
    // Severity drives the tone; volume alone does not.
    expect(by['open-risk-signals']!.value).toBe('3')
    expect(by['open-risk-signals']!.sub).toBe('none high-severity')
    expect(by['open-risk-signals']!.tone).toBe('neutral')
  })

  it('still escalates when the severity actually warrants it', async () => {
    const f = mockFetch({ runs: [], breaks: [], pending: [], risk: [{ severity: 'high' }, { severity: 'info' }] })
    const by = Object.fromEntries((await getDashboardKpis('tok', P, deps(f))).map((k) => [k.key, k]))
    expect(by['open-risk-signals']!.tone).toBe('breach')
    expect(by['open-risk-signals']!.sub).toContain('1 high / critical')
  })

  /**
   * BACKOFFICE-94 follow-up — the tone can only tell the truth about signals it actually read.
   *
   * `/back-office/risk-signals` is cursor-paginated. Both dashboard readers requested one page of
   * 200 and treated it as the whole set. That was already wrong; making tone follow SEVERITY is
   * what made it matter — a single high-severity signal on page two now leaves the card reading
   * "none high-severity" in calm navy, confidently reporting the absence of something it never
   * looked for.
   *
   * The old fixture could not have caught this: it never sent a `next_cursor`, so a client that
   * ignored one looked identical to a client that honoured it.
   */
  it('follows the cursor, so severity on a later page still escalates', async () => {
    const f = mockFetch({
      runs: [],
      breaks: [],
      pending: [],
      risk: [
        [{ severity: 'info' }, { severity: 'low' }],
        [{ severity: 'info' }, { severity: 'critical' }] // page two carries the one that matters
      ]
    })
    const by = Object.fromEntries((await getDashboardKpis('tok', P, deps(f))).map((k) => [k.key, k]))
    expect(by['open-risk-signals']!.value).toBe('4') // both pages counted, not just the first
    expect(by['open-risk-signals']!.sub).toContain('1 high / critical')
    expect(by['open-risk-signals']!.tone).toBe('breach')
  })

  it('buckets the severity chart across every page too', async () => {
    const f = mockFetch({
      runs: [],
      breaks: [],
      pending: [],
      risk: [[{ severity: 'high' }], [{ severity: 'high' }, { severity: 'info' }]]
    })
    const charts = await getDashboardCharts('tok', deps(f))
    const by = Object.fromEntries(charts.riskSeverity.map((b) => [b.label, b.count]))
    expect(by.High).toBe(2) // one from each page — the KPI and the chart agree on "open"
    expect(by.Info).toBe(1)
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

  /**
   * BACKOFFICE-94 — the headline figure is a SUMMARY FIGURE, so it is DM Sans.
   *
   * `design/tokens.ts` divides the three faces explicitly: DM Sans for "UI + summary figures",
   * JetBrains Mono for "ids, exact amounts, trace ids". This card carried `font-mono` "per the
   * Stitch financial-numerals rule" — a rule from a design source ADR 0033 RETIRED, still being
   * followed after the system that replaced it said the opposite. At 30px it read as terminal
   * output in the middle of a financial console.
   *
   * The gate next door (`design-conformance.spec.ts`) could not catch this: `font-mono` is a
   * perfectly good token utility, and that gate checks that screens speak in tokens, not that they
   * say something true with them. `tabular-nums` is asserted alongside because dropping mono must
   * not cost the digit alignment — DM Sans carries the feature itself.
   */
  it('sets the headline figure in DM Sans with tabular numerals, not a code face', () => {
    render(<DashboardOverview kpis={[{ key: 'open-breaks', label: 'Open breaks', value: '5', tone: 'break' }]} />)
    const figure = screen.getByText('5')
    expect(figure.className).not.toContain('font-mono')
    expect(figure.className).toContain('tabular-nums')
  })

  it('renders nothing when there are no entitled KPIs', () => {
    render(<DashboardOverview kpis={[]} />)
    expect(screen.queryByTestId('dashboard-overview')).not.toBeInTheDocument()
  })
})

import { DashboardCharts } from '../src/components/dashboard-charts.js'

describe('getDashboardCharts', () => {
  it('builds the recon pass-rate trend (oldest→newest) + severity buckets', async () => {
    const f = mockFetch({
      runs: [
        { reconciliation_window_start: '2026-06-18', line_count_total: 1000, line_count_matched: 990, line_count_unmatched: 10, line_count_disputed: 0, status: 'completed', created_at: '2026-06-18' },
        { reconciliation_window_start: '2026-06-17', line_count_total: 1000, line_count_matched: 1000, line_count_unmatched: 0, line_count_disputed: 0, status: 'completed', created_at: '2026-06-17' },
        { reconciliation_window_start: '2026-06-16', line_count_total: 0, line_count_matched: 0, line_count_unmatched: 0, line_count_disputed: 0, status: 'running', created_at: '2026-06-16' }
      ],
      breaks: [],
      pending: [],
      risk: [{ severity: 'critical' }, { severity: 'high' }, { severity: 'medium' }, { severity: 'low' }]
    })
    const c = await getDashboardCharts('tok', deps(f))
    expect(c.reconTrend.map((p) => p.date)).toEqual(['2026-06-17', '2026-06-18']) // sorted asc, empty/running excluded
    expect(c.reconTrend[0]!.pct).toBe(100)
    expect(c.reconTrend[1]!.pct).toBe(99)
    const sev = Object.fromEntries(c.riskSeverity.map((b) => [b.label, b]))
    expect(sev['Critical']!.count).toBe(1)
    expect(sev['Critical']!.tone).toBe('breach')
    expect(sev['Medium']!.tone).toBe('break')
    expect(sev['Info']!.count).toBe(0)
  })

  it('yields empty series when a source 403s', async () => {
    const f = mockFetch({ runs: [], breaks: [], pending: [], risk: null })
    const c = await getDashboardCharts('tok', deps(f))
    expect(c.riskSeverity).toEqual([])
  })
})

describe('DashboardCharts', () => {
  it('renders the trend + severity charts; nothing when both empty', () => {
    const { rerender } = render(
      <DashboardCharts
        reconTrend={[{ date: '2026-06-17', pct: 100 }, { date: '2026-06-18', pct: 99 }]}
        riskSeverity={[{ label: 'Critical', count: 2, tone: 'breach' }, { label: 'Low', count: 0, tone: 'neutral' }]}
      />
    )
    expect(screen.getByTestId('recon-trend-chart')).toBeInTheDocument()
    expect(screen.getByTestId('risk-severity-chart')).toBeInTheDocument()
    expect(screen.getByTestId('sev-critical')).toHaveTextContent('2')

    rerender(<DashboardCharts reconTrend={[]} riskSeverity={[{ label: 'Critical', count: 0, tone: 'breach' }]} />)
    expect(screen.queryByTestId('dashboard-charts')).not.toBeInTheDocument()
  })
})
