/**
 * UX-09 — app-level 404. An unknown route would otherwise surface Next's default screen
 * (no DEMO banner, no way back). This keeps the root-layout DEMO banner in place and offers
 * a calm, token-styled recovery with a link back into the portal. Server component.
 */
export default function NotFound() {
  return (
    <main className="min-h-screen bg-surface text-on-surface flex items-center justify-center p-8">
      <div className="max-w-md w-full bg-surface-container-lowest border border-outline-variant rounded-xl p-6 space-y-3" data-testid="not-found">
        <h1 className="text-lg font-semibold text-on-surface">Page not found</h1>
        <p className="text-sm text-on-surface-variant">
          That route doesn’t exist in the back office. It may have moved, or the link is out of date.
        </p>
        <a href="/dashboard" className="inline-block text-sm font-semibold text-secondary hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          ← Back to dashboard
        </a>
      </div>
    </main>
  )
}
