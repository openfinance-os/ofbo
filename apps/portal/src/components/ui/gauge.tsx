'use client'

import { Arc } from '@visx/shape'

/**
 * UIF-01b — a radial gauge (ADR 0016 D2). The Stitch "Refined" System-Heartbeat / risk-posture
 * dial: a 270° track with a value arc proportional to value/max. Geometry comes from @visx as
 * an SVG path `d` ATTRIBUTE (the design-conformance gate forbids inline `style` props); colour
 * is token `fill-*` only. Accessible as an ARIA `meter` (value/min/max + label); the SVG itself
 * is decorative (`aria-hidden`) with the figure shown as centred text. A `'use client'` island
 * (ADR 0016 D2) so @visx stays in the browser bundle, never the Cloudflare Worker server bundle.
 */

const SIZE = 120
const STROKE = 12
const R = SIZE / 2
const INNER_R = R - STROKE
const START = -Math.PI * 0.75 // -135°
const SWEEP = Math.PI * 1.5 // 270°

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

export function Gauge({
  value,
  max = 100,
  label,
  unit = ''
}: {
  value: number
  max?: number
  label: string
  unit?: string
}) {
  const clamped = Math.max(0, Math.min(value, max))
  const frac = max > 0 ? clamped / max : 0
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={max}
      className="relative inline-flex items-center justify-center"
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <g transform={`translate(${R} ${R})`}>
          <Arc
            innerRadius={INNER_R}
            outerRadius={R}
            startAngle={START}
            endAngle={START + SWEEP}
            cornerRadius={STROKE / 2}
            className="fill-surface-container"
          />
          <Arc
            data-testid="gauge-value-arc"
            innerRadius={INNER_R}
            outerRadius={R}
            startAngle={START}
            endAngle={START + SWEEP * frac}
            cornerRadius={STROKE / 2}
            className="fill-secondary"
          />
        </g>
      </svg>
      <span className="absolute font-mono text-lg font-bold tabular-nums text-on-surface">
        {fmt(clamped)}
        {unit}
      </span>
    </div>
  )
}
