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
      {/* Wraps on narrow viewports. A title plus a `shrink-0` action is wider than a phone
          (the TPP-cost console's "Request period close" put this row at 486px in a 340px
          card, scrolling the whole document), and neither half can be allowed to squash:
          the title carries meaning and the action is a control. So the row folds instead,
          and the title block gets min-w-0 so a long title truncates within its own line
          rather than pushing the action off the edge. */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 border-b border-outline-variant px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id={hid} className="text-sm font-bold uppercase tracking-widest text-primary">{title}</h2>
          {meta}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}
