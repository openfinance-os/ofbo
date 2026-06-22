import { formatMoney, isMoney, sectionsOf, type AnalyticsView, type FreshnessEnvelope } from '../lib/analytics'
import { ErrorBanner, statusTone } from './ui'
import { AnalyticsSections } from './analytics/analytics-sections'

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
  errorRemediation?: string | null
  errorDocsUrl?: string | null
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
 * Status badge — the tone vocabulary is the canonical shared map (components/ui/status-badge,
 * UX-01); only recognised tokens are badged, arbitrary strings stay plain so ids/labels are
 * never mislabelled.
 */
function StatusBadge({ value }: { value: string }) {
  const tone = statusTone(value)
  if (!tone) return <span className="font-mono break-words">{value}</span>
  return (
    <span data-testid={`status-${value.toLowerCase().replace(/\s+/g, '-')}`} className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${tone}`}>
      {value.replace(/_/g, ' ')}
    </span>
  )
}

/** Map a distribution key to a bar fill via the same status vocabulary as the badges. */
function barFill(key: string): string {
  const t = statusTone(key)
  if (!t) return 'fill-secondary'
  if (t.includes('breach')) return 'fill-breach'
  if (t.includes('break')) return 'fill-break'
  if (t.includes('reconciled')) return 'fill-reconciled'
  return 'fill-outline'
}

/** A plain object whose values are ALL finite numbers (a distribution like by_severity /
 *  by_line_type / outcome counts) — 2–8 entries, not all zero. Charted as horizontal bars. */
function numericDistribution(value: unknown): [string, number][] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || isMoney(value)) return null
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length < 2 || entries.length > 8) return null
  if (!entries.every(([, v]) => typeof v === 'number' && Number.isFinite(v))) return null
  if (!entries.some(([, v]) => (v as number) > 0)) return null
  return entries as [string, number][]
}

/** Horizontal token-coloured bars for a numeric distribution (SVG — no inline styles/px). */
function MiniBars({ entries }: { entries: [string, number][] }) {
  const max = Math.max(...entries.map(([, v]) => v))
  return (
    <div className="space-y-1.5" data-testid="mini-bars">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-2 text-xs">
          <span className="w-28 shrink-0 text-on-surface-variant truncate" title={humanize(k)}>{humanize(k)}</span>
          <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="flex-1 h-2.5" role="img" aria-label={`${humanize(k)}: ${v}`}>
            <rect x="0" y="0" width="100" height="8" className="fill-surface-container" rx="1" />
            <rect x="0" y="0" width={max > 0 ? (v / max) * 100 : 0} height="8" className={barFill(k)} rx="1" />
          </svg>
          <span className="w-10 shrink-0 font-mono tabular-nums text-primary text-right">{v.toLocaleString('en-US')}</span>
        </div>
      ))}
    </div>
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
                <td key={c} className="py-1 pr-3 align-top text-primary whitespace-nowrap">
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
  if (typeof value === 'string') {
    // an ISO date/timestamp → compact, single-line (never char-wrap in a narrow cell)
    const iso = value.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))/)
    if (iso) return <span className="font-mono text-xs text-on-surface-variant whitespace-nowrap" title={value}>{iso[1]}{iso[2] ? ` ${iso[2]}` : ''}</span>
    // an API/route path reads as a reference, not body text (e.g. a console deeplink)
    if (/^\/[a-z][a-z0-9/_-]*$/i.test(value)) return <code className="font-mono text-xs text-on-surface-variant break-all">{value}</code>
    return <StatusBadge value={value} />
  }
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
  // a numeric distribution (by_severity / by_line_type / outcome counts) → horizontal bars
  const dist = depth <= 1 ? numericDistribution(value) : null
  if (dist) return <MiniBars entries={dist} />
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

/** A top-level scalar number or Money is a headline figure — render it as a prominent KPI
 *  (large, JetBrains-Mono tabular-nums per the Stitch typography principle). */
const isKpi = (v: unknown): v is number | { amount: number; currency: string } => typeof v === 'number' || isMoney(v)

export function MetricGrid({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data)
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="metric-grid">
      {entries.map(([k, v]) => (
        <div key={k} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4" data-testid={`metric-${k}`}>
          <p className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">{humanize(k)}</p>
          {isKpi(v) ? (
            <p className="font-mono font-semibold text-primary text-3xl tabular-nums tracking-tight" data-testid={`kpi-${k}`}>
              {isMoney(v) ? formatMoney(v) : v.toLocaleString('en-US')}
            </p>
          ) : (
            <div className="text-sm text-primary">
              <Value value={v} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export function AnalyticsSection({ title, view, testid }: { title: string; view: AnalyticsView; testid: string }) {
  // UIF-03 — when the BFF emits typed `sections`, render the bespoke panels; otherwise the
  // free-form view still renders generically (backward-compatible).
  const sections = sectionsOf(view)
  return (
    <section data-testid={testid} className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="font-bold text-sm text-primary uppercase tracking-widest">{title}</h2>
        <FreshnessBadge freshness={view.freshness} />
      </div>
      {sections.length > 0 ? <AnalyticsSections sections={sections} /> : <MetricGrid data={view.data} />}
    </section>
  )
}

export function AnalyticsDashboard({ executive, finance, error, errorRemediation, errorDocsUrl }: AnalyticsDashboardProps) {
  return (
    <div className="space-y-8" data-testid="analytics-dashboard">
      <h1 className="text-2xl font-semibold">Analytics &amp; Insights</h1>

      {error ? <ErrorBanner testid="analytics-error" remediation={errorRemediation} docsUrl={errorDocsUrl}>{error}</ErrorBanner> : null}

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
