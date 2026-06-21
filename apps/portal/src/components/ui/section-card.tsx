import type { ReactNode } from 'react'

/**
 * UIF-01 — a named panel with an optional header action (ADR 0016). Same accessible
 * structure as Panel (a WCAG 1.3.1 `<section aria-labelledby>` landmark with a real `<h2 id>`)
 * but adds a right-aligned action slot for the Stitch panel CTAs (e.g. "Generate CBUAE Pack")
 * and an optional freshness/status slot. Token-only (no raw hex/px).
 */

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export function SectionCard({
  title,
  action,
  meta,
  children,
  testid,
  headingId
}: {
  title: string
  action?: ReactNode
  meta?: ReactNode
  children: ReactNode
  testid?: string
  headingId?: string
}) {
  const hid = headingId ?? `section-${slug(title)}-heading`
  return (
    <section
      aria-labelledby={hid}
      data-testid={testid}
      className="rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm"
    >
      <div className="flex items-center justify-between gap-2 border-b border-outline-variant px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 id={hid} className="text-sm font-bold uppercase tracking-widest text-primary">{title}</h2>
          {meta}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}
