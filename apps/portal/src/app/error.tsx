'use client'

import { useEffect } from 'react'
import { ErrorBanner } from '../components/ui/feedback'

/**
 * DEMO-01 — route-segment error boundary. Per-page try/catch covers data-fetch failures, but
 * an unexpected render-time exception (e.g. a malformed BFF payload) would otherwise surface
 * Next's default error screen mid-demo. This keeps the DEMO banner (root layout) in place and
 * shows a calm, token-styled recovery card with a retry. Client component (Next requirement).
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface to the console/telemetry without leaking details to the screen.
    console.error('portal route error', error)
  }, [error])

  return (
    <main className="min-h-screen bg-surface text-on-surface flex items-center justify-center p-8">
      <div className="max-w-md w-full bg-surface-container-lowest border border-outline-variant rounded-xl p-6 space-y-4">
        <h1 className="text-lg font-semibold text-on-surface">Something went wrong</h1>
        <ErrorBanner testid="route-error">
          This screen is temporarily unavailable. The data service may be waking up — please retry.
        </ErrorBanner>
        <button
          type="button"
          onClick={reset}
          className="w-full px-4 py-3 rounded-xl bg-primary text-on-primary font-medium cursor-pointer"
        >
          Retry
        </button>
      </div>
    </main>
  )
}
