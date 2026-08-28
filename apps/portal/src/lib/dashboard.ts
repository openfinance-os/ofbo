/**
 * Executive landing — a scope-aware KPI overview composed from structured endpoints.
 * Each source is fetched independently and a 403 (out-of-scope persona) simply omits that
 * card, so the dashboard degrades gracefully: super-admin sees everything, a narrow persona
 * sees only what its scopes permit. Server-side only (token from the httpOnly cookie).
 */
import { listPendingApprovals } from './approvals'
import { listRuns, listBreaks } from './reconciliation'
import { bffClient } from './bff'
import type { Schemas, KeysConformToContract, AssertContract } from './contract-types'

export type KpiTone = 'breach' | 'break' | 'reconciled' | 'neutral'

export interface Kpi {
  key: string
  label: string
  value: string
  sub?: string
  tone: KpiTone
  href?: string
}

interface Principal {
  subject: string
  scopes: readonly string[]
}

/** Injectable for tests (baseUrl/fetchImpl); production passes nothing → real BFF. */
export interface DashboardDeps {
  baseUrl?: string
  fetchImpl?: typeof fetch
  /**
   * The interaction id for this dashboard render. Mirrors `ApprovalApiDeps.traceId` — the pattern
   * every other portal data module already follows — so a caller can propagate an id in, and so
   * ONE id covers the whole render rather than one per request.
   */
  traceId?: string
}

/**
 * One trace id per dashboard render, resolved once and threaded into every reader.
 *
 * `authHeaders` used to evaluate `crypto.randomUUID()` at call time, so every request the dashboard
 * made carried a different id — and once the risk reader started following a cursor, one logical
 * read emitted up to ten of them. The spec calls this header "the OTel trace ID end-to-end" and
 * CLAUDE.md makes propagation binding; ten ids for one read is the opposite of end-to-end. It also
 * left `DashboardDeps` unable to accept a caller's id at all.
 */
const authHeaders = (token: string, trace: string) => ({ authorization: `Bearer ${token}`, 'x-fapi-interaction-id': trace })

/**
 * Read every page of a cursor-paginated list, or as many as `maxPages` allows.
 *
 * Three dashboard cards each read a list endpoint and each treated the first page as the whole set.
 * That is ONE defect, so it gets one implementation rather than three loops that can drift apart —
 * and `truncated` is returned rather than swallowed, so a caller that stops early has to decide
 * what to SAY about it instead of presenting a bounded read as a complete one.
 */
async function collectPages<T>(
  fetchPage: (cursor: string | null) => Promise<{ items: T[]; next: string | null }>,
  maxPages: number
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = []
  let cursor: string | null = null
  for (let page = 0; page < maxPages; page++) {
    const { items: batch, next } = await fetchPage(cursor)
    items.push(...batch)
    cursor = next
    if (!cursor) return { items, truncated: false }
  }
  return { items, truncated: true }
}

/**
 * A bound on how far a dashboard card will follow a cursor. Not a correctness limit but a latency
 * one — a card must not become an unbounded crawl because a dataset went strange. Past it the
 * reader reports `truncated` and the card says so.
 */
const MAX_PAGES = 10

/** Reconciliation health from the latest run + the open-break queue (reconciliation:read). */
async function reconKpis(token: string, deps: DashboardDeps, trace: string): Promise<Kpi[]> {
  const api = { ...deps, traceId: trace }
  const [{ runs }, breakQueue] = await Promise.all([
    listRuns(token, { limit: 1 }, api),
    // The QUEUE, not its first page. `open > 8 ? 'breach'` silently stopped escalating past 200 —
    // a saturated count cannot report a queue getting worse, which is the only thing this card is
    // for.
    collectPages(async (cursor) => {
      const { breaks, next_cursor } = await listBreaks(token, { limit: 200, ...(cursor ? { cursor } : {}) }, api)
      return { items: breaks, next: next_cursor }
    }, MAX_PAGES)
  ])
  const breaks = breakQueue.items
  const out: Kpi[] = []
  const latest = runs[0]
  if (latest && latest.line_count_total > 0) {
    const pct = Math.round((latest.line_count_matched / latest.line_count_total) * 1000) / 10
    out.push({
      key: 'recon-pass-rate',
      label: 'Reconciliation pass rate',
      value: `${pct}%`,
      sub: `${latest.line_count_matched.toLocaleString('en-US')} / ${latest.line_count_total.toLocaleString('en-US')} lines · latest run`,
      tone: pct >= 99 ? 'reconciled' : pct >= 95 ? 'break' : 'breach',
      href: '/reconciliation'
    })
  }
  const open = breaks.filter((b) => b.status === 'flagged' || b.status === 'assigned').length
  out.push({
    key: 'open-breaks',
    label: 'Open reconciliation breaks',
    value: breakQueue.truncated ? `${open}+` : String(open),
    sub: open === 0
      ? 'queue clear'
      : breakQueue.truncated
        ? `at least ${open} awaiting claim / resolution`
        : 'awaiting claim / resolution',
    tone: open === 0 ? 'reconciled' : open > 8 ? 'breach' : 'break',
    href: '/reconciliation'
  })
  return out
}

/** Pending four-eyes the caller can action (dynamic scope → available to every persona). */
async function approvalsKpi(token: string, deps: DashboardDeps, trace: string): Promise<Kpi[]> {
  const api = { ...deps, traceId: trace }
  // Sending no `limit` means the BFF applies the spec default of 50, so this card read "50" as
  // though that were the queue. `listPendingApprovals` already returned `next_cursor`; the
  // dashboard destructured it away.
  const { items: approvals, truncated } = await collectPages(async (cursor) => {
    const page = await listPendingApprovals(token, cursor ? { cursor } : {}, api)
    return { items: page.approvals, next: page.next_cursor }
  }, MAX_PAGES)
  return [
    {
      key: 'pending-approvals',
      label: 'Pending four-eyes approvals',
      value: truncated ? `${approvals.length}+` : String(approvals.length),
      sub: approvals.length === 0
        ? 'nothing awaiting you'
        : truncated
          ? `at least ${approvals.length} awaiting a second principal`
          : 'awaiting a second principal',
      // NEUTRAL, not `break`. `break` paints the figure in `ext.status.aging`, whose token
      // definition is "open, approaching its clock" — and nothing here consults a clock. Every
      // pending approval was amber, so five requests sitting comfortably inside their two-hour
      // window (PRD §10) looked like five running out of it. A queue that is always amber tells an
      // operator nothing on the day one of them genuinely IS aging.
      tone: 'neutral',
      href: '/approvals'
    }
  ]
}

/** The contract's maximum page size for this list (spec: `limit` max 200). */
const RISK_PAGE_LIMIT = 200

/**
 * The one field both risk readers actually read, bound to the contract.
 *
 * It was declared inline as `{ severity: string }` in two places, which widened the five-member
 * enum to `string` and bound nothing: rename or drop `severity` in the spec and `typecheck` stays
 * green while the KPI and the chart quietly bucket everything into zero. `contract-types.ts` exists
 * for exactly this (ADR-0004), and `approvals.ts` / `reconciliation.ts` already use it.
 */
export interface OpenRiskSignal {
  // NonNullable because the generated schema types make every field optional, while the portal's
  // view types are deliberately narrower — the pattern contract-types.ts documents. The KEY is what
  // the guard below binds; a spec rename or removal is what must fail typecheck.
  severity: NonNullable<Schemas['RiskSignal']['severity']>
}
export type OpenRiskSignalContractGuard = AssertContract<KeysConformToContract<OpenRiskSignal, Schemas['RiskSignal']>>
/**
 * Every open risk signal, following the cursor — not the first page pretending to be the set.
 *
 * `/back-office/risk-signals` is cursor-paginated and signals continuation through
 * `meta.next_cursor`; both dashboard readers used to request `limit=200` once and treat whatever
 * came back as complete. That was already wrong, and BACKOFFICE-94 made it MATTER: once tone
 * follows severity rather than mere volume, a single high-severity signal sitting on page two
 * leaves the card reading "none high-severity" in calm navy — the card confidently reporting the
 * absence of something it never looked for. That is the same defect class as pricing an unmodelled
 * liability at zero: not silence, which gets investigated, but a confident wrong answer.
 *
 * One reader for both callers, so the KPI count and the severity buckets cannot disagree about
 * what "open" means.
 */
async function openRiskSignals(
  token: string,
  deps: DashboardDeps,
  trace: string
): Promise<{ signals: OpenRiskSignal[]; truncated: boolean }> {
  const { base, f } = bffClient(deps)
  const { items, truncated } = await collectPages<OpenRiskSignal>(async (cursor) => {
    const query = `status=open&limit=${RISK_PAGE_LIMIT}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const res = await f(`${base}/back-office/risk-signals?${query}`, { headers: authHeaders(token, trace) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as { data?: OpenRiskSignal[]; meta?: { next_cursor?: string | null } }
    return { items: body.data ?? [], next: body.meta?.next_cursor ?? null }
  }, MAX_PAGES)
  return { signals: items, truncated }
}

/** Open risk signals by severity from the risk-signals list (risk:read). */
async function riskKpi(token: string, deps: DashboardDeps, trace: string): Promise<Kpi[]> {
  const { signals, truncated } = await openRiskSignals(token, deps, trace)
  const critical = signals.filter((s) => s.severity === 'critical' || s.severity === 'high').length
  return [
    {
      key: 'open-risk-signals',
      label: 'Open risk signals',
      value: truncated ? `${signals.length}+` : String(signals.length),
      // When the set is truncated, "none high-severity" would be a claim about signals nobody
      // read. Say what was actually looked at instead.
      sub: critical > 0
        ? `${critical} high / critical`
        : truncated
          ? `none high-severity in the first ${signals.length}`
          : 'none high-severity',
      // The tone must agree with the sub-label directly beneath it. It used to read
      // `signals.length > 0 ? 'break'`, so 200 INFO-severity signals rendered in the amber that
      // means "approaching its clock" above a caption reading "none high-severity" — the colour
      // contradicting the words under it, on the demo's first screen. Severity drives the tone
      // now, which is what the card is about; volume alone is just a count.
      tone: critical > 0 ? 'breach' : 'neutral',
      href: '/risk'
    }
  ]
}

/** Compose the entitled KPI cards; an out-of-scope source is silently skipped. */
export async function getDashboardKpis(token: string, _principal: Principal, deps: DashboardDeps = {}): Promise<Kpi[]> {
  // ONE id for the whole render, so the four reads a dashboard performs correlate as one
  // interaction rather than four.
  const trace = deps.traceId ?? crypto.randomUUID()
  const settled = await Promise.allSettled([
    approvalsKpi(token, deps, trace),
    reconKpis(token, deps, trace),
    riskKpi(token, deps, trace)
  ])
  return settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
}

// ── Chart data (scope-aware; each source omitted on a 403, like the KPIs) ──────────────
export interface TrendPoint {
  date: string // YYYY-MM-DD
  pct: number // reconciliation pass rate, 0–100
}
export interface SeverityBar {
  label: string
  count: number
  tone: KpiTone
}
export interface DashboardCharts {
  reconTrend: TrendPoint[]
  riskSeverity: SeverityBar[]
  /**
   * True when the severity buckets describe only as much of the set as `MAX_PAGES` allowed.
   *
   * `openRiskSignals` returns this and the KPI card consumes it; the chart used to destructure it
   * away and render a bounded read as the complete distribution, with the panel's own total printed
   * from it. Two callers of one reader disagreeing about whether the answer is complete is how a
   * partial read becomes a confident one.
   */
  riskSeverityTruncated: boolean
}

/** Up to 30 days of reconciliation pass-rate, oldest→newest (reconciliation:read). */
async function reconTrend(token: string, deps: DashboardDeps, trace: string): Promise<TrendPoint[]> {
  const { runs } = await listRuns(token, { limit: 60 }, { ...deps, traceId: trace })
  return runs
    .filter((r) => r.line_count_total > 0 && r.status === 'completed')
    .map((r) => ({ date: (r.reconciliation_window_start || r.created_at).slice(0, 10), pct: Math.round((r.line_count_matched / r.line_count_total) * 1000) / 10 }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30)
}

const SEVERITY_ORDER: { key: string; label: string; tone: KpiTone }[] = [
  { key: 'critical', label: 'Critical', tone: 'breach' },
  { key: 'high', label: 'High', tone: 'breach' },
  { key: 'medium', label: 'Medium', tone: 'break' },
  { key: 'low', label: 'Low', tone: 'neutral' },
  { key: 'info', label: 'Info', tone: 'neutral' }
]

/** Open risk signals bucketed by severity (risk:read). */
async function riskSeverity(
  token: string,
  deps: DashboardDeps,
  trace: string
): Promise<{ bars: SeverityBar[]; truncated: boolean }> {
  const { signals, truncated } = await openRiskSignals(token, deps, trace)
  const counts = new Map<string, number>()
  for (const s of signals) counts.set(s.severity, (counts.get(s.severity) ?? 0) + 1)
  return { bars: SEVERITY_ORDER.map(({ key, label, tone }) => ({ label, tone, count: counts.get(key) ?? 0 })), truncated }
}

/** Chart series for the dashboard; an out-of-scope source yields an empty series (card hidden). */
export async function getDashboardCharts(token: string, deps: DashboardDeps = {}): Promise<DashboardCharts> {
  const trace = deps.traceId ?? crypto.randomUUID()
  const [trend, severity] = await Promise.allSettled([reconTrend(token, deps, trace), riskSeverity(token, deps, trace)])
  return {
    reconTrend: trend.status === 'fulfilled' ? trend.value : [],
    riskSeverity: severity.status === 'fulfilled' ? severity.value.bars : [],
    riskSeverityTruncated: severity.status === 'fulfilled' ? severity.value.truncated : false
  }
}
