import { OfboMark } from './ofbo-mark'
import { ECOSYSTEM, BANK_ROLES, GUARDRAILS, SCREEN_GUIDE } from '../lib/screen-guide'

/**
 * UX — the introductory guide. A strong "start here" explainer for operators who know
 * their job but not the UAE Open Finance scheme: what Open Finance is, why the bank
 * needs a back office, the control fabric that runs underneath, and a tour of every
 * screen (what it is · how it helps · why the ecosystem requires it). Content is the
 * single source of truth in lib/screen-guide.ts — the same map the per-screen overlay
 * reads, and the same narrative mirrored in the repo README.
 *
 * Rendered both standalone (for a newcomer at the sign-in screen) and inside the app
 * shell (for a signed-in operator), so `chromeless` toggles the standalone header/brand.
 * Token-only, zero PII.
 */
export function GuideContent({ chromeless = false }: { chromeless?: boolean }) {
  return (
    <div className="mx-auto w-full max-w-4xl">
      {chromeless ? (
        <div className="mb-8 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2.5">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-nav" aria-hidden>
              <OfboMark className="h-6 w-6" />
            </span>
            <span className="flex items-baseline gap-2">
              <span className="text-xl font-bold tracking-tight text-on-surface">OFBO</span>
              <span className="text-sm text-on-surface-variant">Open Finance Back Office</span>
            </span>
          </span>
          <a
            href="/"
            data-testid="guide-back-to-signin"
            className="inline-flex items-center gap-1 rounded-lg border border-outline-variant px-3 py-1.5 text-sm font-semibold text-on-surface hover:border-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="font-symbols text-base" aria-hidden>
              login
            </span>
            Back to sign-in
          </a>
        </div>
      ) : null}

      {/* Hero */}
      <section className="mb-10 rounded-2xl border border-outline-variant bg-nav p-6 text-on-nav sm:p-8" data-testid="guide-hero">
        <p className="text-xs font-bold uppercase tracking-widest text-nav-active">Start here</p>
        <h1 className="mt-2 text-2xl font-semibold leading-snug text-white sm:text-3xl">
          Why this back office exists — and why each screen is here
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-on-nav">
          OFBO is the operations back office a UAE bank runs to operate Open Finance as a regulated business. Most people
          who open it know their own job — care, finance, risk — but not why the scheme obliges the bank to run all of
          this. This page explains the why, in plain language, before you touch a single screen.
        </p>
      </section>

      {/* What is Open Finance */}
      <Section title="What is Open Finance, in one paragraph">
        <p className="text-sm leading-relaxed text-on-surface-variant">
          Open Finance lets a customer (the <strong className="text-on-surface">PSU</strong> — payment service user) give a
          licensed third party permission to access their bank data, or to initiate a payment on their behalf. The customer
          is always in control and can withdraw permission at any time. In the UAE this runs through a single, regulated
          ecosystem:
        </p>
        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {ECOSYSTEM.map((a) => (
            <div key={a.name} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
              <dt className="text-sm font-semibold text-on-surface">{a.name}</dt>
              <dd className="mt-1 text-xs leading-relaxed text-on-surface-variant">{a.detail}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {/* The bank's two roles */}
      <Section title="The bank wears two hats — OFBO runs both">
        <p className="text-sm leading-relaxed text-on-surface-variant">
          Newcomers usually picture only the first role. The scheme requires the bank to operate both, and a discrepancy in
          either one is the bank’s problem to find and fix.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {BANK_ROLES.map((r) => (
            <div key={r.role} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
              <p className="text-sm font-semibold text-on-surface">{r.role}</p>
              <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">{r.plain}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* The control fabric */}
      <Section title="The guardrails underneath every screen">
        <p className="text-sm leading-relaxed text-on-surface-variant">
          OFBO is not a CRUD app — it is a regulated control surface. Four things are true on every screen, because the
          scheme and CBUAE supervision require the bank to be able to prove them:
        </p>
        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {GUARDRAILS.map((g) => (
            <li key={g.title} className="flex gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
              <span className="font-symbols mt-0.5 shrink-0 text-xl text-secondary" aria-hidden>
                {g.icon}
              </span>
              <div>
                <p className="text-sm font-semibold text-on-surface">{g.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">{g.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      {/* The screen tour */}
      <Section title="A tour of the screens — and why each is required">
        <p className="text-sm leading-relaxed text-on-surface-variant">
          Each role sees only the screens its mandate covers (that separation is itself a control), so you may not have all
          of these. Here is every console, what it helps you do, and the obligation it answers.
        </p>
        <div className="mt-5 space-y-4">
          {SCREEN_GUIDE.map((s) => (
            <article
              key={s.key}
              data-testid={`guide-screen-${s.key}`}
              className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5"
            >
              <h3 className="flex items-center gap-2.5 text-base font-semibold text-on-surface">
                <span className="font-symbols text-xl text-secondary" aria-hidden>
                  {s.icon}
                </span>
                {s.title}
              </h3>
              <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <TourField label="What it is" body={s.whatItIs} />
                <TourField label="How it helps you" body={s.helpsYou} />
                <TourField label="Why Open Finance requires it" body={s.whyOpenFinance} />
              </dl>
            </article>
          ))}
        </div>
      </Section>

      {/* One incident, every console */}
      <Section title="One incident, every console">
        <p className="text-sm leading-relaxed text-on-surface-variant">
          These screens are not silos. A single event — say an unauthorised payment — shows up as a{' '}
          <strong className="text-on-surface">dispute</strong> in Customer Care, a{' '}
          <strong className="text-on-surface">reconciliation break</strong> in Finance, a{' '}
          <strong className="text-on-surface">risk signal</strong> in Risk, a{' '}
          <strong className="text-on-surface">case</strong> in Operations, and a{' '}
          <strong className="text-on-surface">four-eyes refund</strong> in Approvals — linked as one thread, fully audited
          and lineage-tracked. That end-to-end traceability is the whole point of running Open Finance from one back office.
        </p>
      </Section>

      <p className="mt-8 rounded-xl border border-demo/30 bg-demo/10 p-4 text-xs leading-relaxed text-on-surface-variant">
        <span className="font-semibold text-demo">This is a permanently non-production demo.</span> Every figure is
        synthetic, there is no real customer data anywhere, and all scheme-bound traffic is simulated. You can explore and
        trigger actions freely — nothing here touches a real customer or a real payment.
      </p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-lg font-bold text-on-surface">{title}</h2>
      {children}
    </section>
  )
}

function TourField({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">{label}</dt>
      <dd className="mt-1 text-xs leading-relaxed text-on-surface">{body}</dd>
    </div>
  )
}
