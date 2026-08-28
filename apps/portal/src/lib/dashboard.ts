/**
 * Executive landing — a scope-aware KPI overview composed from structured endpoints.
 * Each source is fetched independently and a 403 (out-of-scope persona) simply omits that
 * card, so the dashboard degrades gracefully: super-admin sees everything, a narrow persona
 * sees only what its scopes permit. Server-side only (token from the httpOnly cookie).
 */
import { listPendingApprovals } from './approvals'
import { listRuns, listBreaks } from './reconciliation'
import { bffClient } from './bff'

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
}

const authHeaders = (token: string) => ({ authorization: `Bearer ${token}`, 'x-fapi-interaction-id': crypto.randomUUID() })

/** Reconciliation health from the latest run + the open-break queue (reconciliation:read). */
async function reconKpis(token: string, deps: DashboardDeps): Promise<Kpi[]> {
  const [{ runs }, { breaks }] = await Promise.all([listRuns(token, { limit: 1 }, deps), listBreaks(token, { limit: 200 }, deps)])
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
    value: String(open),
    sub: open === 0 ? 'queue clear' : 'awaiting claim / resolution',
    tone: open === 0 ? 'reconciled' : open > 8 ? 'breach' : 'break',
    href: '/reconciliation'
  })
  return out
}

/** Pending four-eyes the caller can action (dynamic scope → available to every persona). */
async function approvalsKpi(token: string, deps: DashboardDeps): Promise<Kpi[]> {
  const { approvals } = await listPendingApprovals(token, {}, deps)
  return [
    {
      key: 'pending-approvals',
      label: 'Pending four-eyes approvals',
      value: String(approvals.length),
      sub: approvals.length === 0 ? 'nothing awaiting you' : 'awaiting a second principal',
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
 * A bound on how far the dashboard will follow the cursor: 10 pages = 2,000 open signals. Not a
 * correctness limit but a latency one — a dashboard card must not turn into an unbounded crawl
 * because a demo dataset went strange. Beyond it the reader reports `truncated` and the caller
 * says so rather than describing a partial set as if it were the whole one.
 */
const RISK_MAX_PAGES = 10

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
  deps: DashboardDeps
): Promise<{ signals: { severity: string }[]; truncated: boolean }> {
  const { base, f } = bffClient(deps)
  const signals: { severity: string }[] = []
  let cursor: string | null = null

  for (let page = 0; page < RISK_MAX_PAGES; page++) {
    const query = `status=open&limit=${RISK_PAGE_LIMIT}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const res = await f(`${base}/back-office/risk-signals?${query}`, { headers: authHeaders(token) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as { data?: { severity: string }[]; meta?: { next_cursor?: string | null } }
    signals.push(...(body.data ?? []))
    cursor = body.meta?.next_cursor ?? null
    if (!cursor) return { signals, truncated: false }
  }
  return { signals, truncated: true }
}

/** Open risk signals by severity from the risk-signals list (risk:read). */
async function riskKpi(token: string, deps: DashboardDeps): Promise<Kpi[]> {
  const { signals, truncated } = await openRiskSignals(token, deps)
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
  const settled = await Promise.allSettled([approvalsKpi(token, deps), reconKpis(token, deps), riskKpi(token, deps)])
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
}

/** Up to 30 days of reconciliation pass-rate, oldest→newest (reconciliation:read). */
async function reconTrend(token: string, deps: DashboardDeps): Promise<TrendPoint[]> {
  const { runs } = await listRuns(token, { limit: 60 }, deps)
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
async function riskSeverity(token: string, deps: DashboardDeps): Promise<SeverityBar[]> {
  const { signals } = await openRiskSignals(token, deps)
  const counts = new Map<string, number>()
  for (const s of signals) counts.set(s.severity, (counts.get(s.severity) ?? 0) + 1)
  return SEVERITY_ORDER.map(({ key, label, tone }) => ({ label, tone, count: counts.get(key) ?? 0 }))
}

/** Chart series for the dashboard; an out-of-scope source yields an empty series (card hidden). */
export async function getDashboardCharts(token: string, deps: DashboardDeps = {}): Promise<DashboardCharts> {
  const [trend, severity] = await Promise.allSettled([reconTrend(token, deps), riskSeverity(token, deps)])
  return {
    reconTrend: trend.status === 'fulfilled' ? trend.value : [],
    riskSeverity: severity.status === 'fulfilled' ? severity.value : []
  }
}
