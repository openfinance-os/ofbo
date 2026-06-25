/**
 * The navigation loading fallback. Because each console renders its own AppShell, a bare
 * loading.tsx would briefly collapse the sidebar on every navigation; this skeleton mirrors
 * the shell silhouette (navy rail + light top bar + content) so the transition reads as
 * "the content is loading" rather than a full-page flash. Token-only (no raw hex/px), and
 * its presence gives the force-dynamic routes a prefetch boundary so the chrome prefetches
 * on hover. Purely decorative — aria-hidden, with a single polite status for assistive tech.
 */
export function ShellSkeleton() {
  const rows = ['w-3/4', 'w-2/3', 'w-4/5', 'w-1/2', 'w-3/5', 'w-2/3', 'w-1/2']
  return (
    <div className="flex min-h-screen bg-background text-on-surface" data-testid="shell-skeleton">
      <span className="sr-only" role="status" aria-live="polite">
        Loading…
      </span>
      {/* Sidebar silhouette — matches the lg+ rail width + navy chrome. */}
      <aside aria-hidden className="hidden lg:flex w-60 shrink-0 bg-nav border-r border-nav-elevated flex-col py-container-padding gap-1 px-2">
        <div className="mb-6 px-2 flex items-center gap-2">
          <span className="h-8 w-8 shrink-0 rounded-lg bg-nav-elevated" />
          <span className="h-3 w-24 rounded bg-nav-elevated animate-pulse" />
        </div>
        {rows.map((w, i) => (
          <span key={i} className={`h-9 ${w} rounded-xl bg-nav-elevated/60 animate-pulse`} />
        ))}
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top-bar silhouette. */}
        <header aria-hidden className="flex items-center justify-between gap-3 px-container-padding min-h-16 py-2 bg-surface-container-lowest border-b border-outline-variant">
          <span className="h-7 w-64 rounded-full bg-surface-container animate-pulse" />
          <span className="h-7 w-32 rounded-full bg-surface-container animate-pulse" />
        </header>
        <main aria-hidden className="flex-1 px-container-padding py-6">
          <div className="mx-auto w-full max-w-screen-2xl space-y-6">
            <div className="h-8 w-48 rounded bg-surface-container animate-pulse" />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="h-32 rounded-xl bg-surface-container animate-pulse" />
              <div className="h-32 rounded-xl bg-surface-container animate-pulse" />
            </div>
            <div className="h-64 rounded-xl bg-surface-container animate-pulse" />
          </div>
        </main>
      </div>
    </div>
  )
}
