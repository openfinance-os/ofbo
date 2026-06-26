'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * "Built with" colophon — a discreet trigger on the sign-in screen that explains how OFBO
 * was produced and embeds the interactive harness map (docs/harness-map.html, served from
 * /public). OFBO wasn't hand-built screen by screen: it was assembled by an autonomous
 * AI software-delivery harness run as a regulated Double Diamond (Discover ▸ Define ▸
 * Develop ▸ Deliver) with humans holding the gates. This surfaces that provenance one click
 * from the front page — the spirit of ADR 0019 (sealed agent build-provenance), made visible.
 *
 * Click-to-open (no auto-surfacing modal), token-only, zero PII. The embedded map is a
 * self-contained static artifact; the footer link opens it full-screen in a new tab. The
 * dialog mirrors ScreenGuideOverlay's a11y posture (role=dialog, aria-modal, Esc-to-close,
 * focus moved to the close control on open).
 */
export function BuiltWithHarness() {
  const [open, setOpen] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      {/* Trigger — a subtle pill on the navy welcome panel, matching the guide link's chrome. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="built-with-open"
        aria-haspopup="dialog"
        aria-label="How OFBO was built — open the interactive build-harness map"
        className="inline-flex items-center gap-1.5 self-start rounded-full border border-nav-elevated px-2.5 py-1 text-xs font-medium text-on-nav hover:bg-nav-elevated hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-active"
      >
        <span className="font-symbols text-sm text-nav-active" aria-hidden>
          build
        </span>
        How this was built
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="built-with-title"
          data-testid="built-with-dialog"
          className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
        >
          <button
            type="button"
            aria-label="Close"
            data-testid="built-with-backdrop"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-on-surface/40 backdrop-blur-sm"
          />
          <div className="relative flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-outline-variant bg-surface-container-lowest shadow-lg sm:h-[88vh] sm:rounded-2xl">
            {/* Header */}
            <div className="flex items-start gap-3 border-b border-outline-variant bg-nav p-5 text-on-nav">
              <span className="font-symbols mt-0.5 shrink-0 text-2xl text-nav-active" aria-hidden>
                build
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-widest text-on-nav opacity-80">Build provenance</p>
                <h2 id="built-with-title" className="text-lg font-semibold text-white">
                  How OFBO was built
                </h2>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                data-testid="built-with-close"
                aria-label="Close"
                className="font-symbols shrink-0 text-on-nav hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                close
              </button>
            </div>

            {/* Body — description + embedded interactive map */}
            <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
              <div className="space-y-2.5 text-sm leading-relaxed text-on-surface-variant">
                <p>
                  OFBO wasn&apos;t hand-built screen by screen. It was produced by an autonomous AI software-delivery
                  harness run as a regulated <span className="font-semibold text-on-surface">Double Diamond</span>: it
                  first diverges and converges on the <em>problem</em> (Discover ▸ Define), then on the{' '}
                  <em>solution</em> (Develop ▸ Deliver) — with humans holding the gates at each joint.
                </p>
                <p>
                  Every change is spec-first and contract-first against the OpenAPI canon, must clear a stack of CI
                  quality gates — build &amp; unit, test-integrity, SAST, documentation-integrity, integration +
                  contract, end-to-end, security, and BCBS&nbsp;239 data-lineage — and is screened by independent AI
                  reviewers before a <span className="font-semibold text-on-surface">human merges it</span>. The agent
                  proposes; a person disposes (four-eyes).
                </p>
                <p>
                  Token-bound UI, synthetic data only, zero PII — the same rules this demo runs under. The map below is
                  live: click any phase, gate, governance record, skill, or reviewer to explore it.
                </p>
              </div>
              <iframe
                src="/harness-map.html"
                title="OFBO harness map — interactive Double Diamond visualization"
                data-testid="harness-map-frame"
                loading="lazy"
                className="min-h-0 w-full flex-1 rounded-xl border border-outline-variant bg-surface-container"
              />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 border-t border-outline-variant bg-surface-container px-5 py-3">
              <span className="text-xs text-on-surface-variant">DEMO · synthetic data only · zero PII</span>
              <a
                href="/harness-map.html"
                target="_blank"
                rel="noreferrer"
                data-testid="built-with-full-link"
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-on-primary hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container"
              >
                Open the full map
                <span className="font-symbols text-base" aria-hidden>
                  open_in_new
                </span>
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
