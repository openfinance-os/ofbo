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
  const { approvals } = await listPendingApprovals(token, deps)
  return [
    {
      key: 'pending-approvals',
      label: 'Pending four-eyes approvals',
      value: String(approvals.length),
      sub: approvals.length === 0 ? 'nothing awaiting you' : 'awaiting a second principal',
      tone: approvals.length === 0 ? 'neutral' : 'break',
      href: '/approvals'
    }
  ]
}

/** Open risk signals by severity from the risk-signals list (risk:read). */
async function riskKpi(token: string, deps: DashboardDeps): Promise<Kpi[]> {
  const { base, f } = bffClient(deps)
  const res = await f(`${base}/back-office/risk-signals?status=open&limit=200`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = (await res.json()) as { data?: { severity: string }[] }
  const signals = body.data ?? []
  const critical = signals.filter((s) => s.severity === 'critical' || s.severity === 'high').length
  return [
    {
      key: 'open-risk-signals',
      label: 'Open risk signals',
      value: String(signals.length),
      sub: critical > 0 ? `${critical} high / critical` : 'none high-severity',
      tone: critical > 0 ? 'breach' : signals.length > 0 ? 'break' : 'reconciled',
      href: '/risk'
    }
  ]
}

/** Compose the entitled KPI cards; an out-of-scope source is silently skipped. */
export async function getDashboardKpis(token: string, _principal: Principal, deps: DashboardDeps = {}): Promise<Kpi[]> {
  const settled = await Promise.allSettled([approvalsKpi(token, deps), reconKpis(token, deps), riskKpi(token, deps)])
  return settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
}
