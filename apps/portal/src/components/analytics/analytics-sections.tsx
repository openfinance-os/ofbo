import { SectionCard, StatStrip, KpiStat, ContributionBar, Gauge, statusToneOrNeutral } from '../ui'
import type { AnalyticsSection } from '../../lib/analytics'

/**
 * UIF-03 — the typed analytics-section renderer (ADR 0016 D1, Stitch "Analytics & Insights
 * (Refined)"). Maps each AnalyticsSection `kind` from the analytics contract to a UIF-01/01b
 * primitive — the shared core UIF-03/-04/-05 all use. An unrecognised `kind` (or a section
 * missing its payload) renders nothing, so the caller can fall back to the generic grid.
 * Token-only; bound to the OpenAPI contract; carries no PSU PII.
 */

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const ALERT_TONE: Record<string, string> = {
  info: 'border-l-secondary bg-secondary-fixed/30',
  warning: 'border-l-break bg-break/10',
  critical: 'border-l-breach bg-breach/10'
}

export function AnalyticsSections({ sections }: { sections: AnalyticsSection[] }) {
  return (
    <div className="space-y-4" data-testid="analytics-sections">
      {sections.map((s, i) => (
        <Section key={`${s.kind}-${i}`} section={s} />
      ))}
    </div>
  )
}

function Section({ section: s }: { section: AnalyticsSection }) {
  const testid = `section-${slug(s.title)}`
  switch (s.kind) {
    case 'kpi-strip':
      return s.stats?.length ? (
        <SectionCard title={s.title} testid={testid}>
          <div className="p-4">
            <StatStrip aria-label={s.title}>
              {s.stats.map((st, i) => (
                <KpiStat
                  key={i}
                  label={st.label}
                  value={`${st.value}${st.unit ?? ''}`}
                  sublabel={st.sublabel ?? undefined}
                  trend={st.trend ? { label: st.trend.label, tone: st.trend.tone ?? undefined } : undefined}
                  valueTestid={`stat-${slug(st.label)}`}
                />
              ))}
            </StatStrip>
          </div>
        </SectionCard>
      ) : null
    case 'gauge':
      return s.gauge ? (
        <SectionCard title={s.title} testid={testid}>
          <div className="p-4">
            <Gauge value={s.gauge.value} max={s.gauge.max ?? 100} unit={s.gauge.unit ?? undefined} label={s.title} />
          </div>
        </SectionCard>
      ) : null
    case 'contribution-bars':
      return s.segments?.length ? (
        <SectionCard title={s.title} testid={testid}>
          <div className="p-4">
            <ContributionBar label={s.title} segments={s.segments.map((g) => ({ label: g.label, value: g.value }))} />
          </div>
        </SectionCard>
      ) : null
    case 'status-cards':
      return s.cards?.length ? (
        <SectionCard title={s.title} testid={testid}>
          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {s.cards.map((c, i) => (
              <div key={i} data-testid={`status-card-${slug(c.label)}`} className={`rounded-lg border border-l-4 border-outline-variant p-3 ${statusToneOrNeutral(c.status)}`}>
                <p className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">{c.label}</p>
                {c.value ? <p className="mt-1 font-mono text-lg font-bold tabular-nums">{c.value}</p> : null}
                {c.note ? <p className="mt-1 text-xs text-on-surface-variant">{c.note}</p> : null}
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null
    case 'alert':
      return s.alert ? (
        <div role="note" data-testid={testid} className={`rounded-xl border border-l-4 border-outline-variant p-4 ${ALERT_TONE[s.alert.severity] ?? ALERT_TONE.info}`}>
          <p className="text-sm font-semibold text-on-surface">{s.alert.message}</p>
          {s.alert.remediation ? <p className="mt-1 text-xs text-on-surface-variant">{s.alert.remediation}</p> : null}
        </div>
      ) : null
    case 'object-table':
      return s.table ? (
        <SectionCard title={s.title} testid={testid}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-on-surface-variant">
                  {s.table.columns.map((col) => (
                    <th key={col} scope="col" className="px-4 py-2 text-left font-semibold">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.table.rows.map((row, ri) => (
                  <tr key={ri}>
                    {s.table!.columns.map((col) => (
                      <td key={col} className="px-4 py-2 text-on-surface-variant">{String(row[col] ?? '—')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null
    default:
      return null
  }
}
