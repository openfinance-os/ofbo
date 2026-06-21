/**
 * DEMO-01 — route-level loading state. Pages are force-dynamic server components, so a slow
 * first request (cold BFF Worker / Hyperdrive pool waking) would otherwise leave a blank tab
 * with no feedback — reading as a hang in a live demo. This token-styled skeleton gives the
 * audience immediate "it's working" feedback under the persistent DEMO banner.
 */
export default function Loading() {
  return (
    <main role="status" aria-label="Loading" className="min-h-screen bg-surface text-on-surface p-8">
      <div className="max-w-5xl mx-auto space-y-6 animate-pulse">
        <div className="h-8 w-64 rounded-lg bg-surface-container-high" />
        <div className="grid grid-cols-2 gap-4">
          <div className="h-24 rounded-xl bg-surface-container" />
          <div className="h-24 rounded-xl bg-surface-container" />
          <div className="h-24 rounded-xl bg-surface-container" />
          <div className="h-24 rounded-xl bg-surface-container" />
        </div>
        <div className="h-64 rounded-xl bg-surface-container-low border border-outline-variant" />
        <span className="text-on-surface-variant text-sm">Loading the latest data…</span>
      </div>
    </main>
  )
}
