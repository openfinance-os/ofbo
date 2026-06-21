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

/**
 * UX-06 — the error banner now surfaces the API error envelope's `remediation` (what the
 * operator can do about it) and `docs_url` (deeper guidance) when present, instead of dropping
 * them. Message-only callers are unaffected (both are optional).
 */
export function ErrorBanner({
  children,
  testid,
  remediation,
  docsUrl
}: {
  children: ReactNode
  testid?: string
  remediation?: string | null
  docsUrl?: string | null
}) {
  // Defence-in-depth: only render the docs link for an http(s) URL, even though it comes from
  // the trusted BFF envelope — never let a stray javascript:/data: value become a live href.
  const safeDocsUrl = docsUrl && /^https?:\/\//i.test(docsUrl) ? docsUrl : null
  return (
    <div role="alert" data-testid={testid} className="bg-error-container text-on-error-container text-sm px-4 py-3 rounded-lg space-y-1">
      <p>{children}</p>
      {remediation ? (
        <p className="text-xs opacity-90" data-testid={testid ? `${testid}-remediation` : undefined}>
          {remediation}
        </p>
      ) : null}
      {safeDocsUrl ? (
        <a
          href={safeDocsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-xs font-semibold underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          data-testid={testid ? `${testid}-docs` : undefined}
        >
          View remediation guidance →
        </a>
      ) : null}
    </div>
  )
}
