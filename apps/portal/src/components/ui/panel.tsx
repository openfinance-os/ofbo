import type { ReactNode } from 'react'

/**
 * UX-01 — a labelled panel region. The recon console pattern: a panel is a WCAG 1.3.1
 * landmark `<section aria-labelledby>` with a real `<h2 id>` so screen-reader region
 * navigation finds it, and a count badge is `aria-hidden` paired with an `sr-only` phrase
 * (count is never colour/number-alone). Other consoles used bare `<div>`s with unlinked
 * `<h2>`s; this centralises the accessible structure. Token-only (no raw hex/px).
 */

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export function Panel({
  title,
  count,
  countLabel,
  children,
  testid,
  headingId
}: {
  title: string
  count?: number
  countLabel?: string
  children: ReactNode
  testid?: string
  headingId?: string
}) {
  const hid = headingId ?? `panel-${slug(title)}-heading`
  return (
    <section aria-labelledby={hid} data-testid={testid} className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm">
      <div className="px-4 py-3 border-b border-outline-variant flex items-center gap-2">
        <h2 id={hid} className="font-bold text-sm text-primary uppercase tracking-widest">{title}</h2>
        {count != null ? (
          <>
            <span aria-hidden="true" className="bg-secondary-fixed text-on-secondary-fixed px-2 py-0.5 rounded-full text-xs font-bold">{count}</span>
            <span className="sr-only">{count} {countLabel ?? 'items'}</span>
          </>
        ) : null}
      </div>
      {children}
    </section>
  )
}
