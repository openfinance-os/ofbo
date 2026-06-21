/**
 * UIF-01 — a horizontal contribution/stacked bar (ADR 0016). The single most common Stitch
 * "Refined" viz (product-family contribution, certification pipeline, liability thresholds).
 * Drawn as an SVG (0–100 viewBox) so proportional geometry lives in `rect` width/x ATTRIBUTES
 * — the design-conformance gate forbids inline `style` props in components. Segment widths are
 * value / total, normalised so a non-100 total still fills the track. The bar is `aria-hidden`
 * (decorative); semantics live in the legend (label + percentage), never colour-alone. Fills
 * are token-only `fill-*` utilities (no raw hex/px).
 */

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// Distinct, token-only segment fills (cycled). All keys exist in design/tokens.ts.
const SEG_FILL = ['fill-secondary', 'fill-secondary-fixed-dim', 'fill-primary-fixed-dim', 'fill-surface-tint', 'fill-outline'] as const

export type ContributionSegment = { label: string; value: number }

export function ContributionBar({ label, segments }: { label: string; segments: ContributionSegment[] }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1
  // round to 4dp so proportional geometry doesn't carry float noise (57.999…) into the DOM
  const pct = (v: number) => Math.round(((v / total) * 100) * 1e4) / 1e4
  let x = 0
  const rects = segments.map((seg, i) => {
    const w = pct(seg.value)
    const rect = { label: seg.label, x, w, fill: SEG_FILL[i % SEG_FILL.length] }
    x += w
    return rect
  })
  return (
    <div role="group" aria-label={label}>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container">
        <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
          {rects.map((r) => (
            <rect
              key={r.label}
              data-testid={`contribution-seg-${slug(r.label)}`}
              x={r.x}
              y={0}
              width={r.w}
              height={6}
              className={r.fill}
            />
          ))}
        </svg>
      </div>
      <ul className="mt-2 flex flex-col gap-1">
        {segments.map((seg) => (
          <li key={seg.label} className="flex items-center justify-between text-xs">
            <span className="text-on-surface-variant">{seg.label}</span>
            <span className="font-mono tabular-nums text-on-surface">{Math.round(pct(seg.value))}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
