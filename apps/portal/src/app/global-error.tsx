'use client'

import { useEffect } from 'react'
import { DemoPill } from '../components/demo-banner'
import './globals.css'

/**
 * DEMO-01 — last-resort boundary for an error thrown in the root layout itself (where the
 * per-segment error.tsx cannot help). It REPLACES the root layout, so it must render its own
 * <html>/<body> and re-import globals.css for the design tokens. Kept deliberately minimal.
 * The DEMO marker is rendered here too — the root-layout one is bypassed on this boundary,
 * and the non-prod notice is a hard-stop that must hold on every screen.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('portal global error', error)
  }, [error])

  return (
    <html lang="en">
      <body>
        <DemoPill />
        <main className="min-h-screen bg-surface text-on-surface flex items-center justify-center p-8">
          <div className="max-w-md w-full bg-surface-container-lowest border border-outline-variant rounded-xl p-6 space-y-4">
            <h1 className="text-lg font-semibold text-on-surface">OFBO is temporarily unavailable</h1>
            <p role="alert" className="bg-error-container text-on-error-container text-sm px-4 py-3 rounded-lg">
              The portal hit an unexpected error. Please retry; if it persists the demo stack may be restarting.
            </p>
            <button
              type="button"
              onClick={reset}
              className="w-full px-4 py-3 rounded-xl bg-primary text-on-primary font-medium cursor-pointer"
            >
              Retry
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}
