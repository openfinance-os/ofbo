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

/** Render a single contract value: money, scalar, array, or nested object (capped depth). */
function Value({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (isMoney(value)) return <span className="font-mono">{formatMoney(value)}</span>
  if (value === null || value === undefined) return <span className="text-on-surface-variant">—</span>
  if (typeof value === 'number') return <span className="font-mono">{value.toLocaleString('en-US')}</span>
  if (typeof value === 'boolean' || typeof value === 'string') return <span className="font-mono break-all">{String(value)}</span>
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-on-surface-variant">none</span>
    return (
      <ul className="space-y-1">
        {value.slice(0, 8).map((item, i) => (
          <li key={i} className="text-xs">
            {typeof item === 'object' && item !== null && !isMoney(item) ? <Value value={item} depth={depth + 1} /> : <Value value={item} depth={depth + 1} />}
          </li>
        ))}
        {value.length > 8 ? <li className="text-xs text-on-surface-variant">+{value.length - 8} more</li> : null}
      </ul>
    )
  }
  // object
  if (depth >= 2) return <span className="font-mono text-xs text-on-surface-variant">{'{…}'}</span>
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
