import type { ReactNode } from 'react'

/**
 * UX-01 — shared feedback primitives. The recon console (BACKOFFICE-15) proved the
 * pattern: a success/notice banner is a WCAG 4.1.3 status message (role="status") and an
 * error banner is an assertive alert (role="alert"). These centralise that so every screen
 * announces server-action outcomes to assistive tech instead of rendering a silent <p>.
 * Token-only (no raw hex/px). testid is passed through to preserve each screen's existing
 * test hooks.
 */

export function Notice({ children, testid }: { children: ReactNode; testid?: string }) {
  return (
    <p role="status" data-testid={testid} className="bg-reconciled/10 text-reconciled text-sm px-4 py-3 rounded-lg">
      {children}
    </p>
  )
}

export function ErrorBanner({ children, testid }: { children: ReactNode; testid?: string }) {
  return (
    <p role="alert" data-testid={testid} className="bg-error-container text-on-error-container text-sm px-4 py-3 rounded-lg">
      {children}
    </p>
  )
}
