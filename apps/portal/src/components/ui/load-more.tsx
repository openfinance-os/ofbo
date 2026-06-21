/**
 * UX-04 — server-rendered cursor pagination control. The list getters return next_cursor
 * but the pages discarded it, so long lists truncated silently — a trust/correctness gap in
 * a regulated console. This renders a "more available" indicator and a forward "Next page →"
 * link (the page builds the href, preserving its other params + setting this list's cursor).
 * Forward cursor navigation (replace), the honest server-rendered cursor pattern. Token-only.
 */
export function LoadMore({ moreHref, shown, noun = 'items' }: { moreHref: string | null; shown: number; noun?: string }) {
  if (shown === 0) return null
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-2 text-xs text-on-surface-variant border-t border-outline-variant" data-testid="load-more">
      <span data-testid="load-more-status">
        {shown} {noun} shown{moreHref ? ' · more available' : ' · all loaded'}
      </span>
      {moreHref ? (
        <a
          href={moreHref}
          data-testid="load-more-link"
          className="font-semibold text-secondary hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Next page →
        </a>
      ) : null}
    </div>
  )
}
