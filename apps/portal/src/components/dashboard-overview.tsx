import Link from 'next/link'
import type { Kpi, KpiTone } from '../lib/dashboard'

/**
 * Executive landing — a row of scope-aware KPI cards above the audit trail, so an audience
 * (or an operator) gets the headline state of the back office at a glance. Token-only; the
 * prominent figure uses JetBrains-Mono tabular-nums per the Stitch financial-numerals rule.
 */
const TONE: Record<KpiTone, { ring: string; value: string; dot: string }> = {
  breach: { ring: 'border-breach/30', value: 'text-breach', dot: 'bg-breach' },
  break: { ring: 'border-break/30', value: 'text-break', dot: 'bg-break' },
  reconciled: { ring: 'border-reconciled/30', value: 'text-reconciled', dot: 'bg-reconciled' },
  neutral: { ring: 'border-outline-variant', value: 'text-primary', dot: 'bg-outline' }
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  const t = TONE[kpi.tone]
  const body = (
    <div className={`bg-surface-container-lowest border ${t.ring} rounded-xl p-4 h-full transition-colors hover:bg-surface-container`} data-testid={`kpi-${kpi.key}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${t.dot}`} />
        <p className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">{kpi.label}</p>
      </div>
      <p className={`font-mono font-semibold text-3xl tabular-nums tracking-tight ${t.value}`}>{kpi.value}</p>
      {kpi.sub ? <p className="text-xs text-on-surface-variant mt-1">{kpi.sub}</p> : null}
    </div>
  )
  return kpi.href ? (
    <Link href={kpi.href} className="block">
      {body}
    </Link>
  ) : (
    body
  )
}

export function DashboardOverview({ kpis }: { kpis: Kpi[] }) {
  if (kpis.length === 0) return null
  return (
    <section className="mb-8" data-testid="dashboard-overview" aria-label="back office overview">
      {/* UX-10 — one consistent 4-up KPI breakpoint ladder (matches recon + investigation). */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <KpiCard key={k.key} kpi={k} />
        ))}
      </div>
    </section>
  )
}
