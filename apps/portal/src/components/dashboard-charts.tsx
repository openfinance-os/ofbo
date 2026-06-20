import type { TrendPoint, SeverityBar, KpiTone } from '../lib/dashboard'

/**
 * Dashboard data visualizations — token-only, hand-rolled SVG (no chart lib, no raw hex/px;
 * geometry is unitless SVG viewBox coordinates, colours are design-system token classes via
 * fill-/stroke- utilities). Matches the Stitch chart references (SLO & Error Budget /
 * Executive Command Dashboard): thin strokes, tabular numerals, calm — institutional, not playful.
 */

const FILL: Record<KpiTone, string> = {
  breach: 'fill-breach',
  break: 'fill-break',
  reconciled: 'fill-reconciled',
  neutral: 'fill-outline'
}

/** Area + line reconciliation pass-rate trend. viewBox 0..100 × 0..100; Y inverted (0 = top). */
function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) return <p className="text-xs text-on-surface-variant">Not enough runs yet for a trend.</p>
  // Y axis: zoom to the data band (min 90% floor) so daily movement is visible, capped 100.
  const vals = points.map((p) => p.pct)
  const lo = Math.min(90, Math.floor(Math.min(...vals)))
  const hi = 100
  const x = (i: number) => (i / (points.length - 1)) * 100
  const y = (v: number) => 100 - ((v - lo) / (hi - lo || 1)) * 100
  const line = points.map((p, i) => `${x(i).toFixed(2)},${y(p.pct).toFixed(2)}`).join(' ')
  const area = `0,100 ${line} 100,100`
  const last = points[points.length - 1]!
  return (
    <div data-testid="recon-trend-chart">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Reconciliation pass rate · {points.length}d</p>
        <p className="font-mono text-sm font-semibold text-reconciled tabular-nums">{last.pct}%</p>
      </div>
      <div className="text-reconciled">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-28" role="img" aria-label="reconciliation pass-rate trend">
          {/* gridlines */}
          <g className="text-outline-variant">
            {[0, 50, 100].map((gy) => (
              <line key={gy} x1="0" x2="100" y1={gy} y2={gy} stroke="currentColor" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
            ))}
          </g>
          <polygon points={area} fill="currentColor" opacity="0.08" />
          <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="flex justify-between mt-1">
        <span className="font-mono text-xs text-on-surface-variant">{points[0]!.date.slice(5)}</span>
        <span className="font-mono text-xs text-on-surface-variant">{lo}–100%</span>
        <span className="font-mono text-xs text-on-surface-variant">{last.date.slice(5)}</span>
      </div>
    </div>
  )
}

/** Vertical severity-distribution bars, coloured by the status triad. */
function SeverityChart({ bars }: { bars: SeverityBar[] }) {
  const max = Math.max(1, ...bars.map((b) => b.count))
  const total = bars.reduce((a, b) => a + b.count, 0)
  return (
    <div data-testid="risk-severity-chart">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Open risk signals by severity</p>
        <p className="font-mono text-sm font-semibold text-primary tabular-nums">{total}</p>
      </div>
      <div className="flex items-end gap-3 h-28">
        {bars.map((b) => (
          <div key={b.label} className="flex-1 flex flex-col items-center justify-end h-full" data-testid={`sev-${b.label.toLowerCase()}`}>
            <span className="font-mono text-xs font-semibold text-on-surface tabular-nums mb-1">{b.count}</span>
            <div className="w-full flex items-end h-full">
              <svg viewBox="0 0 10 100" preserveAspectRatio="none" className="w-full h-full" role="img" aria-label={`${b.label}: ${b.count}`}>
                <rect x="1" y={100 - (b.count / max) * 100} width="8" height={(b.count / max) * 100} className={FILL[b.tone]} rx="0.5" />
              </svg>
            </div>
            <span className="text-xs text-on-surface-variant mt-1 uppercase tracking-wide">{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function DashboardCharts({ reconTrend, riskSeverity }: { reconTrend: TrendPoint[]; riskSeverity: SeverityBar[] }) {
  const hasTrend = reconTrend.length >= 2
  const hasSeverity = riskSeverity.some((b) => b.count > 0)
  if (!hasTrend && !hasSeverity) return null
  return (
    <section className="mb-8 grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="dashboard-charts" aria-label="overview charts">
      {hasTrend ? (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4">
          <TrendChart points={reconTrend} />
        </div>
      ) : null}
      {hasSeverity ? (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4">
          <SeverityChart bars={riskSeverity} />
        </div>
      ) : null}
    </section>
  )
}
