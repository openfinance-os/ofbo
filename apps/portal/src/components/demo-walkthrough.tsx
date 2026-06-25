'use client'

import { useState } from 'react'
import Link from 'next/link'
import { WALKTHROUGH, OPENING, CLOSING, INCIDENT } from '../lib/demo-walkthrough'

// Interactive presenter walkthrough of the INC-2026-0042 thread (companion to docs/demo-script.md).
// A jump rail + an active-step card with prev/next. Token-only, no PII.
export function DemoWalkthrough() {
  const [active, setActive] = useState(0)
  const step = WALKTHROUGH[active]!
  const atStart = active === 0
  const atEnd = active === WALKTHROUGH.length - 1

  return (
    <div className="space-y-6" data-testid="demo-walkthrough">
      <header>
        <p className="text-sm font-bold uppercase tracking-widest text-secondary">~10-minute guided walkthrough</p>
        <h1 className="mt-1 text-3xl font-semibold">One incident, {INCIDENT}, across every console</h1>
        <p className="mt-3 max-w-3xl text-on-surface-variant">{OPENING}</p>
      </header>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Jump rail */}
        <nav aria-label="walkthrough steps" className="lg:w-56 lg:shrink-0 lg:sticky lg:top-20 lg:self-start">
          <ol className="space-y-1">
            {WALKTHROUGH.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  data-testid={`step-tab-${s.id}`}
                  aria-current={i === active ? 'step' : undefined}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    i === active ? 'bg-secondary text-on-secondary font-semibold' : 'text-on-surface-variant hover:bg-surface-container'
                  }`}
                >
                  <span
                    className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      i === active ? 'bg-on-secondary/20' : 'bg-surface-container'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="truncate">{s.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        {/* Active step */}
        <section className="min-w-0 flex-1 rounded-xl border border-outline-variant bg-surface-container-lowest p-6 shadow-sm" data-testid={`step-panel-${step.id}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-sm font-bold text-on-secondary">
              {active + 1}
            </span>
            <h2 className="text-xl font-semibold">{step.title}</h2>
            <span className="rounded-full bg-surface-container px-2.5 py-0.5 text-xs font-semibold text-on-surface-variant" data-testid="step-persona">
              {step.persona}
            </span>
            {step.console && (
              <Link
                href={step.console.href}
                data-testid="step-console-link"
                className="ml-auto rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-on-secondary transition-colors hover:bg-secondary-container"
              >
                Open {step.console.label} →
              </Link>
            )}
          </div>

          <ol className="mt-4 space-y-2">
            {step.actions.map((a, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-secondary" />
                <span>{a}</span>
              </li>
            ))}
          </ol>

          <div className="mt-4 rounded-lg border border-secondary/30 bg-secondary/5 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-wide text-secondary">What this proves</p>
            <p className="mt-1 text-sm text-on-surface">{step.proves}</p>
          </div>

          <p className="mt-4 border-l-2 border-outline-variant pl-3 text-sm italic text-on-surface-variant">“{step.say}”</p>

          <div className="mt-6 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setActive((a) => Math.max(0, a - 1))}
              disabled={atStart}
              data-testid="step-prev"
              className="rounded-md border border-outline-variant px-3 py-1.5 text-sm font-semibold hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-50"
            >
              ← Previous
            </button>
            <span className="text-xs text-on-surface-variant">
              Step {active + 1} of {WALKTHROUGH.length}
            </span>
            <button
              type="button"
              onClick={() => setActive((a) => Math.min(WALKTHROUGH.length - 1, a + 1))}
              disabled={atEnd}
              data-testid="step-next"
              className="rounded-md bg-secondary px-3 py-1.5 text-sm font-bold text-on-secondary transition-colors hover:bg-secondary-container disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next →
            </button>
          </div>
        </section>
      </div>

      {atEnd && (
        <section className="rounded-xl border border-reconciled/30 bg-reconciled/5 p-6" data-testid="walkthrough-close">
          <p className="text-xs font-bold uppercase tracking-wide text-reconciled">The close</p>
          <p className="mt-2 max-w-3xl text-on-surface">{CLOSING}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/readiness" className="rounded-lg bg-secondary px-4 py-2 text-sm font-bold text-on-secondary hover:bg-secondary-container">
              Check your bank’s readiness →
            </Link>
            <Link href="/maturity" className="rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold hover:bg-surface-container">
              See what’s already built
            </Link>
          </div>
        </section>
      )}
    </div>
  )
}
