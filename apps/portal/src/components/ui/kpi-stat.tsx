import type { ReactNode } from 'react'

/**
 * UIF-01 — a single big-number stat (ADR 0016). The Stitch "Refined" screens lead with
 * large mono-tabular figures (revenue, margin, counts) over a small caps label, with an
 * optional toned trend delta and a sublabel. `role=group` + `aria-label` associates the
 * value with its label so it is never a number-alone. Token-only (no raw hex/px).
 */

export type StatTone = 'reconciled' | 'break' | 'breach' | 'neutral'

const TREND_TONE: Record<StatTone, string> = {
  reconciled: 'text-reconciled',
  break: 'text-break',
  breach: 'text-breach',
  neutral: 'text-on-surface-variant'
}

export function KpiStat({
  label,
  value,
  sublabel,
  trend,
  valueTestid
}: {
  label: string
  value: ReactNode
  sublabel?: ReactNode
  trend?: { label: string; tone?: StatTone }
  valueTestid?: string
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1">
      <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">{label}</span>
      <span
        data-testid={valueTestid ?? 'kpi-value'}
        className="text-3xl font-mono tabular-nums font-bold leading-none text-on-surface"
      >
        {value}
      </span>
      {trend ? (
        <span className={`text-xs font-medium ${TREND_TONE[trend.tone ?? 'neutral']}`}>{trend.label}</span>
      ) : null}
      {sublabel ? <span className="text-xs text-on-surface-variant">{sublabel}</span> : null}
    </div>
  )
}
