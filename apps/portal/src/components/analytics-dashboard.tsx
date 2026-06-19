import { formatMoney, isMoney, type AnalyticsView, type FreshnessEnvelope } from '../lib/analytics'

/**
 * UI-06 — Analytics & Insights Dashboard, translated from the Stitch "OFBO - Analytics
 * & Insights Dashboard" screen (project 8050269076066130289). Presentational + server-
 * rendered. The Executive Dashboard (-27) and Finance View (-31) responses carry data
 * free-form by contract, so this renders them GENERICALLY (contract-first): a labelled
 * metric grid + the mandatory data-freshness indicator (-40). Token-only (no raw hex/px).
 */

export interface AnalyticsDashboardProps {
  executive?: AnalyticsView | null
  finance?: AnalyticsView | null
  error?: string | null
}

const humanize = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export function FreshnessBadge({ freshness }: { freshness: FreshnessEnvelope }) {
  const tone = freshness.stale ? 'bg-break/10 text-break' : 'bg-reconciled/10 text-reconciled'
  return (
    <span data-testid="freshness" data-stale={freshness.stale ? 'true' : 'false'} title={freshness.stale_cause ?? 'fresh'} className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${tone}`}>
      {freshness.stale ? `Stale · ${freshness.stale_cause ?? 'unknown'}` : 'Fresh'}
    </span>
  )
}

/**
 * Operational status vocabulary → the Stitch status triad (breach=red, break=amber,
 * reconciled=green) + neutral. Only recognised tokens are badged; arbitrary strings stay
 * plain so ids/labels are never mislabelled. Keys normalised (lower-case, spaces→_).
 */
const STATUS_TONE: Record<string, string> = {
  breach: 'bg-breach/10 text-breach', breached: 'bg-breach/10 text-breach', critical: 'bg-breach/10 text-breach', high: 'bg-breach/10 text-breach',
  rejected: 'bg-breach/10 text-breach', failed: 'bg-breach/10 text-breach', error: 'bg-breach/10 text-breach', down: 'bg-breach/10 text-breach',
  suspended: 'bg-breach/10 text-breach', overdue: 'bg-breach/10 text-breach', rjct: 'bg-breach/10 text-breach',
  break: 'bg-break/10 text-break', warn: 'bg-break/10 text-break', warning: 'bg-break/10 text-break', at_risk: 'bg-break/10 text-break',
  degraded: 'bg-break/10 text-break', awaiting: 'bg-break/10 text-break', pending: 'bg-break/10 text-break', medium: 'bg-break/10 text-break',
  dual_running_required: 'bg-break/10 text-break', pdng: 'bg-break/10 text-break',
  reconciled: 'bg-reconciled/10 text-reconciled', matched: 'bg-reconciled/10 text-reconciled', healthy: 'bg-reconciled/10 text-reconciled',
  up: 'bg-reconciled/10 text-reconciled', ok: 'bg-reconciled/10 text-reconciled', active: 'bg-reconciled/10 text-reconciled',
  resolved: 'bg-reconciled/10 text-reconciled', approved: 'bg-reconciled/10 text-reconciled', passed: 'bg-reconciled/10 text-reconciled',
  registered: 'bg-reconciled/10 text-reconciled', authorized: 'bg-reconciled/10 text-reconciled', acsp: 'bg-reconciled/10 text-reconciled', accc: 'bg-reconciled/10 text-reconciled',
  unknown: 'bg-surface-container text-on-surface-variant', none: 'bg-surface-container text-on-surface-variant',
  info: 'bg-surface-container text-on-surface-variant', low: 'bg-surface-container text-on-surface-variant',
  draft: 'bg-surface-container text-on-surface-variant', directory_only: 'bg-surface-container text-on-surface-variant', dormant: 'bg-surface-container text-on-surface-variant'
}
const statusTone = (s: string): string | null => STATUS_TONE[s.trim().toLowerCase().replace(/\s+/g, '_')] ?? null

function StatusBadge({ value }: { value: string }) {
  const tone = statusTone(value)
  if (!tone) return <span className="font-mono break-all">{value}</span>
  return (
    <span data-testid={`status-${value.toLowerCase().replace(/\s+/g, '-')}`} className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${tone}`}>
      {value.replace(/_/g, ' ')}
    </span>
  )
}

/** A uniform array of objects → a compact, high-density table (the Stitch data-table). */
function ObjectTable({ rows, depth }: { rows: Record<string, unknown>[]; depth: number }) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, 6)
  return (
    <div className="overflow-x-auto" data-testid="object-table">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-outline-variant">
            {cols.map((c) => (
              <th key={c} className="text-left font-bold text-on-surface-variant uppercase tracking-wider py-1 pr-3 whitespace-nowrap">{humanize(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 8).map((r, i) => (
            <tr key={i} className="border-b border-outline-variant/40 hover:bg-surface-container">
              {cols.map((c) => (
                <td key={c} className="py-1 pr-3 align-top text-primary">
                  {c in r ? <Value value={r[c]} depth={depth + 1} /> : <span className="text-on-surface-variant">—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 8 ? <p className="text-xs text-on-surface-variant mt-1">+{rows.length - 8} more</p> : null}
    </div>
  )
}

/** Render a single contract value: money, scalar, status badge, table, or nested group. */
function Value({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (isMoney(value)) return <span className="font-mono">{formatMoney(value)}</span>
  if (value === null || value === undefined) return <span className="text-on-surface-variant">—</span>
  if (typeof value === 'number') return <span className="font-mono">{value.toLocaleString('en-US')}</span>
  if (typeof value === 'boolean') return <span className="font-mono">{String(value)}</span>
  if (typeof value === 'string') return <StatusBadge value={value} />
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-on-surface-variant">none</span>
    // a uniform array of (non-Money) objects renders as a table; otherwise a scalar list
    if (value.every((v) => typeof v === 'object' && v !== null && !isMoney(v))) {
      return <ObjectTable rows={value as Record<string, unknown>[]} depth={depth} />
    }
    return (
      <ul className="space-y-1">
        {value.slice(0, 8).map((item, i) => (
          <li key={i} className="text-xs">
            <Value value={item} depth={depth + 1} />
          </li>
        ))}
        {value.length > 8 ? <li className="text-xs text-on-surface-variant">+{value.length - 8} more</li> : null}
      </ul>
    )
  }
  // nested object → sub-group; only collapse to a key summary at extreme depth (never "{…}")
  if (depth >= 3) {
    return <span className="text-xs text-on-surface-variant break-all">{Object.keys(value as Record<string, unknown>).map(humanize).join(', ')}</span>
  }
  const entries = Object.entries(value as Record<string, unknown>)
  return (
    <dl className="space-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2 text-xs">
          <dt className="text-on-surface-variant">{humanize(k)}</dt>
          <dd className="text-primary text-right">
            <Value value={v} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function MetricGrid({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data)
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="metric-grid">
      {entries.map(([k, v]) => (
        <div key={k} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4" data-testid={`metric-${k}`}>
          <p className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">{humanize(k)}</p>
          <div className="text-sm text-primary">
            <Value value={v} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function AnalyticsSection({ title, view, testid }: { title: string; view: AnalyticsView; testid: string }) {
  return (
    <section data-testid={testid} className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="font-bold text-sm text-primary uppercase tracking-widest">{title}</h2>
        <FreshnessBadge freshness={view.freshness} />
      </div>
      <MetricGrid data={view.data} />
    </section>
  )
}

export function AnalyticsDashboard({ executive, finance, error }: AnalyticsDashboardProps) {
  return (
    <div className="space-y-8" data-testid="analytics-dashboard">
      <h1 className="text-2xl font-semibold">Analytics &amp; Insights</h1>

      {error ? (
        <p className="bg-error-container text-on-error-container text-sm px-4 py-3 rounded-lg" data-testid="analytics-error">
          {error}
        </p>
      ) : null}

      {executive ? <AnalyticsSection title="Executive Dashboard" view={executive} testid="executive-section" /> : null}
      {finance ? <AnalyticsSection title="Finance View" view={finance} testid="finance-section" /> : null}

      {!executive && !finance && !error ? (
        <p className="text-sm text-on-surface-variant" data-testid="analytics-empty">
          No analytics views available for your scope.
        </p>
      ) : null}
    </div>
  )
}
