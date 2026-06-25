'use client'

import { usePathname } from 'next/navigation'
import { ShellSkeleton } from '../components/ui/shell-skeleton'

/**
 * Route-level loading fallback. Adding it gives every console a Suspense boundary, so the
 * force-dynamic routes prefetch their chrome on hover and a navigation shows an instant
 * skeleton instead of a frozen page. The chromeless surfaces (sign-in, the evaluator funnel,
 * access-denied) render outside the shell, so we show a minimal centred placeholder for those
 * and the full shell silhouette for everything else — keyed off the destination path.
 */
const CHROMELESS = new Set(['/', '/demo', '/readiness', '/maturity', '/access-denied'])

export default function Loading() {
  const pathname = usePathname()
  if (pathname && CHROMELESS.has(pathname)) {
    return (
      <main className="flex min-h-screen items-center justify-center" data-testid="route-loading">
        <span className="sr-only" role="status" aria-live="polite">
          Loading…
        </span>
        <span aria-hidden className="h-10 w-10 rounded-full border-2 border-outline-variant border-t-primary animate-spin" />
      </main>
    )
  }
  return <ShellSkeleton />
}
