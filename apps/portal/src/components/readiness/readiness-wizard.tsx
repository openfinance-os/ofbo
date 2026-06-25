'use client'

import { useMemo, useState } from 'react'
import type {
  ReadinessCatalog,
  ReadinessDigest,
  ReadinessProfile,
  ReadinessAssessmentInput
} from '../../lib/readiness'
import { ReadinessDigestView } from './readiness-digest'

type Step = 'hero' | 'estate' | 'governance' | 'digest'

const EFFORT_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', scoping: 'Scoping' }

export function ReadinessWizard({
  catalog,
  initialProfile
}: {
  catalog: ReadinessCatalog
  initialProfile?: ReadinessProfile | null
}) {
  const [step, setStep] = useState<Step>(initialProfile ? 'digest' : 'hero')
  const [ports, setPorts] = useState<Record<string, string>>(initialProfile?.input.ports ?? {})
  const [decisions, setDecisions] = useState<Record<string, string>>(initialProfile?.input.decisions ?? {})
  const [digest, setDigest] = useState<ReadinessDigest | null>(initialProfile?.digest ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const input = useMemo<ReadinessAssessmentInput>(() => ({ ports, decisions }), [ports, decisions])
  const selectedCount = Object.keys(ports).filter((k) => ports[k]).length

  async function runAssessment() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/readiness/assess', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input)
      })
      const body = (await res.json()) as ReadinessDigest & { error?: { message?: string } }
      if (!res.ok) throw new Error(body.error?.message ?? 'Assessment failed.')
      setDigest(body)
      setStep('digest')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Assessment failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6" data-testid="readiness-wizard">
      <Stepper step={step} />

      {step === 'hero' && <Hero onStart={() => setStep('estate')} />}

      {step === 'estate' && (
        <EstateStep
          catalog={catalog}
          ports={ports}
          onChange={(id, value) => setPorts((p) => ({ ...p, [id]: value }))}
          onBack={() => setStep('hero')}
          onNext={() => setStep('governance')}
          selectedCount={selectedCount}
        />
      )}

      {step === 'governance' && (
        <GovernanceStep
          catalog={catalog}
          decisions={decisions}
          onChange={(id, value) => setDecisions((d) => ({ ...d, [id]: value }))}
          onBack={() => setStep('estate')}
          onAssess={runAssessment}
          busy={busy}
          error={error}
        />
      )}

      {step === 'digest' && digest && (
        <ReadinessDigestView
          digest={digest}
          input={input}
          onRevise={() => setStep('estate')}
          savedProfile={initialProfile ?? null}
        />
      )}
    </div>
  )
}

function Stepper({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'hero', label: 'Start' },
    { key: 'estate', label: 'Map your estate' },
    { key: 'governance', label: 'Confirm decisions' },
    { key: 'digest', label: 'Readiness digest' }
  ]
  const idx = steps.findIndex((s) => s.key === step)
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs font-semibold" aria-label="progress">
      {steps.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 ${
              i <= idx ? 'bg-secondary text-on-secondary' : 'bg-surface-container text-on-surface-variant'
            }`}
            aria-current={i === idx ? 'step' : undefined}
          >
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-on-secondary/20">{i + 1}</span>
            {s.label}
          </span>
          {i < steps.length - 1 && <span aria-hidden className="text-outline">›</span>}
        </li>
      ))}
    </ol>
  )
}

function Hero({ onStart }: { onStart: () => void }) {
  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-8 shadow-sm">
      <p className="text-sm font-bold uppercase tracking-widest text-secondary">For UAE banks running Open Finance</p>
      <h1 className="mt-2 text-3xl font-semibold">You passed CBUAE certification. Can you operationally run it yet?</h1>
      <p className="mt-4 max-w-2xl text-on-surface-variant">
        Reconciling Nebras fees, handling consent revocations and disputes, and catching liability before the
        monthly invoice all need a back office. The OFBO platform already ships every screen on synthetic data —
        the only thing between you and production is wiring it to <strong>your</strong> systems.
      </p>
      <p className="mt-3 max-w-2xl text-on-surface-variant">
        Map your estate to the nine integration ports, confirm sixteen pre-set decisions, and get a personalised
        readiness digest: per-port effort, the contract tests each adapter must pass, a generated Bank Profile, and
        a suggested go-live sequence. Takes about five minutes. No sign-in, no real data.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={onStart}
          data-testid="readiness-start"
          className="rounded-lg bg-secondary px-5 py-2.5 text-sm font-bold text-on-secondary transition-colors hover:bg-secondary-container"
        >
          Start the assessment →
        </button>
        <span className="text-xs text-on-surface-variant">9 ports · 16 decisions · synthetic-only</span>
      </div>
    </section>
  )
}

function EstateStep({
  catalog,
  ports,
  onChange,
  onBack,
  onNext,
  selectedCount
}: {
  catalog: ReadinessCatalog
  ports: Record<string, string>
  onChange: (id: string, value: string) => void
  onBack: () => void
  onNext: () => void
  selectedCount: number
}) {
  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-xl font-semibold">Map your estate to the nine ports</h2>
        <p className="text-sm text-on-surface-variant">
          Pick the system you run behind each integration port. Not sure yet? Leave it — it scores as “needs scoping”.
        </p>
      </header>

      <div className="grid gap-3">
        {catalog.ports.map((port) => (
          <div
            key={port.id}
            className="grid gap-3 rounded-lg border border-outline-variant bg-surface-container-lowest p-4 sm:grid-cols-[1fr,auto] sm:items-center"
            data-testid={`port-row-${port.id}`}
          >
            <div>
              <p className="font-semibold">
                <span className="mr-2 rounded bg-surface-container px-1.5 py-0.5 font-mono text-xs text-on-surface-variant">{port.id}</span>
                {port.name}
                {port.optional && <span className="ml-2 text-xs font-normal text-on-surface-variant">(optional)</span>}
              </p>
              <p className="mt-0.5 text-sm text-on-surface-variant">{port.maps_to}</p>
            </div>
            <select
              aria-label={`${port.id} ${port.name} system`}
              data-testid={`port-select-${port.id}`}
              value={ports[port.id] ?? ''}
              onChange={(e) => onChange(port.id, e.target.value)}
              className="min-w-56 rounded-md border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-secondary focus:outline-none"
            >
              <option value="">Select a system…</option>
              {port.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label} · {EFFORT_LABEL[o.effort_band]}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <button type="button" onClick={onBack} className="text-sm font-semibold text-on-surface-variant hover:underline">
          ← Back
        </button>
        <div className="flex items-center gap-3">
          <span className="text-xs text-on-surface-variant">{selectedCount} of 9 mapped</span>
          <button
            type="button"
            onClick={onNext}
            data-testid="estate-next"
            className="rounded-lg bg-secondary px-4 py-2 text-sm font-bold text-on-secondary transition-colors hover:bg-secondary-container"
          >
            Next: confirm decisions →
          </button>
        </div>
      </div>
    </section>
  )
}

function GovernanceStep({
  catalog,
  decisions,
  onChange,
  onBack,
  onAssess,
  busy,
  error
}: {
  catalog: ReadinessCatalog
  decisions: Record<string, string>
  onChange: (id: string, value: string) => void
  onBack: () => void
  onAssess: () => void
  busy: boolean
  error: string | null
}) {
  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-xl font-semibold">Confirm the sixteen adopting-bank decisions</h2>
        <p className="text-sm text-on-surface-variant">
          Each carries the product’s pre-set default. Leave it to accept, or type your bank’s answer to override.
        </p>
      </header>

      <div className="grid gap-2">
        {catalog.decisions.map((d) => (
          <div key={d.id} className="rounded-lg border border-outline-variant bg-surface-container-lowest p-4" data-testid={`decision-row-${d.id}`}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-xs text-on-surface-variant">{d.id}</span>
              <span className="font-semibold">{d.title}</span>
              {d.blocks && (
                <span className="rounded-full bg-break/15 px-2 py-0.5 text-xs font-semibold text-break">blocks {d.blocks}</span>
              )}
            </div>
            <p className="mt-1 text-xs text-on-surface-variant">{d.impact}</p>
            <input
              type="text"
              aria-label={`${d.id} answer`}
              data-testid={`decision-input-${d.id}`}
              value={decisions[d.id] ?? ''}
              placeholder={`Default: ${d.default}`}
              onChange={(e) => onChange(d.id, e.target.value)}
              className="mt-2 w-full rounded-md border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-sm text-on-surface placeholder:text-on-surface-variant/70 focus:border-secondary focus:outline-none"
            />
          </div>
        ))}
      </div>

      {error && (
        <p className="rounded-lg border border-error/30 bg-error-container px-4 py-3 text-sm text-on-surface" data-testid="governance-error">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between">
        <button type="button" onClick={onBack} className="text-sm font-semibold text-on-surface-variant hover:underline">
          ← Back
        </button>
        <button
          type="button"
          onClick={onAssess}
          disabled={busy}
          aria-busy={busy}
          data-testid="run-assessment"
          className="rounded-lg bg-secondary px-5 py-2.5 text-sm font-bold text-on-secondary transition-colors hover:bg-secondary-container disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Scoring…' : 'See my readiness digest →'}
        </button>
      </div>
    </section>
  )
}
