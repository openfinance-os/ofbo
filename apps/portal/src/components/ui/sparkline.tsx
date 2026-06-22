'use client'

import { LinePath } from '@visx/shape'
import { scaleLinear } from '@visx/scale'

/**
 * UIF-01b — a sparkline trend line (ADR 0016 D2). The small line on the Stitch dashboard
 * metric tiles (TPP traffic / error rate / settlement volume). @visx draws it as an SVG path
 * `d` ATTRIBUTE (the design-conformance gate forbids inline `style` props); colour is the token
 * `stroke-*` only. Labelled as an `img` for AT (the trend is summarised by the label + the
 * accompanying KpiStat). A `'use client'` island (ADR 0016 D2) so @visx stays in the browser
 * bundle, never the Cloudflare Worker server bundle.
 */

const W = 100
const H = 28
const PAD = 2

export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length === 0) return <span role="img" aria-label={label} className="inline-block" />

  const x = scaleLinear({ domain: [0, Math.max(values.length - 1, 1)], range: [PAD, W - PAD] })
  const min = Math.min(...values)
  const max = Math.max(...values)
  const y = scaleLinear({ domain: [min, max === min ? min + 1 : max], range: [H - PAD, PAD] })
  const points = values.map((v, i) => ({ i, v }))

  return (
    <span role="img" aria-label={label} className="inline-block">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <LinePath
          data={points}
          x={(d) => x(d.i)}
          y={(d) => y(d.v)}
          data-testid="sparkline-path"
          className="fill-none stroke-secondary"
          strokeWidth={1.5}
        />
      </svg>
    </span>
  )
}
