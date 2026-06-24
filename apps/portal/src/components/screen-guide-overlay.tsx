'use client'

import { useEffect, useRef, useState } from 'react'
import { screenGuideFor } from '../lib/screen-guide'

/**
 * UX — the per-screen "why am I looking at this?" overlay. A clearly-labelled help
 * control in the app shell header opens a dismissible panel that explains the active
 * console in plain language: what it is, what it helps you do, and WHY the UAE Open
 * Finance ecosystem (CBUAE · Al Tareq · Nebras) requires it. Content comes from
 * lib/screen-guide.ts — the same source the /guide page renders — so the in-app help
 * and the page never drift.
 *
 * Click-to-open (no auto-surfacing modal): a blocking first-run dialog would intercept
 * the page on every fresh entry — intrusive for operators and a pointer-events trap for
 * automated flows. The strong introduction is the /guide page, prominently linked from
 * the sign-in screen; this button puts the per-screen "why" one click away from anywhere.
 *
 * Token-only, zero PII. The button is always present (even on screens without a specific
 * entry) so the full guide is reachable from any console.
 */
export function ScreenGuideOverlay({ activeKey }: { activeKey?: string }) {
  const [open, setOpen] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const guide = screenGuideFor(activeKey)

  // Esc closes; move focus to the close button when opened (a11y).
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="screen-guide-open"
        aria-haspopup="dialog"
        aria-label={guide ? `About this screen: ${guide.title}` : 'About OFBO and Open Finance'}
        className="flex items-center gap-1.5 rounded-full border border-outline-variant px-3 py-1 text-sm text-on-surface-variant hover:border-secondary hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="font-symbols text-lg" aria-hidden>
          help
        </span>
        <span className="hidden sm:inline">About this screen</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="screen-guide-title"
          data-testid="screen-guide-dialog"
          className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
        >
          <button
            type="button"
            aria-label="Close"
            data-testid="screen-guide-backdrop"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-on-surface/40 backdrop-blur-sm"
          />
          <div className="relative w-full max-w-lg overflow-hidden rounded-t-2xl border border-outline-variant bg-surface-container-lowest shadow-lg sm:rounded-2xl">
            {/* Header */}
            <div className="flex items-start gap-3 border-b border-outline-variant bg-nav p-5 text-on-nav">
              <span className="font-symbols mt-0.5 shrink-0 text-2xl text-nav-active" aria-hidden>
                {guide?.icon ?? 'menu_book'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-widest text-on-nav opacity-80">Why this screen exists</p>
                <h2 id="screen-guide-title" className="text-lg font-semibold text-white">
                  {guide?.title ?? 'Open Finance Back Office'}
                </h2>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                data-testid="screen-guide-close"
                aria-label="Close"
                className="font-symbols shrink-0 text-on-nav hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                close
              </button>
            </div>

            {/* Body */}
            <div className="space-y-4 p-5">
              {guide ? (
                <>
                  <GuideRow icon="visibility" label="What this is" body={guide.whatItIs} />
                  <GuideRow icon="task_alt" label="How it helps you" body={guide.helpsYou} />
                  <GuideRow icon="account_balance" label="Why Open Finance requires it" body={guide.whyOpenFinance} />
                </>
              ) : (
                <p className="text-sm leading-relaxed text-on-surface-variant">
                  OFBO is the back office a UAE bank runs to operate Open Finance as a regulated business — for both its
                  account-holder (LFI) and TPP-of-record roles, under CBUAE · Al&nbsp;Tareq · Nebras. The full guide explains
                  every screen and why the scheme requires it.
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 border-t border-outline-variant bg-surface-container px-5 py-3">
              <span className="text-xs text-on-surface-variant">DEMO · synthetic data only · zero PII</span>
              <a
                href="/guide"
                data-testid="screen-guide-full-link"
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-on-primary hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container"
              >
                Open the full guide
                <span className="font-symbols text-base" aria-hidden>
                  arrow_forward
                </span>
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function GuideRow({ icon, label, body }: { icon: string; label: string; body: string }) {
  return (
    <div className="flex gap-3">
      <span className="font-symbols mt-0.5 shrink-0 text-xl text-secondary" aria-hidden>
        {icon}
      </span>
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">{label}</p>
        <p className="text-sm leading-relaxed text-on-surface">{body}</p>
      </div>
    </div>
  )
}
