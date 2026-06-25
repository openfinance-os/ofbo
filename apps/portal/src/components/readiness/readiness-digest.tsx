'use client'

import { useState } from 'react'
import type { ReadinessDigest, ReadinessAssessmentInput, ReadinessProfile } from '../../lib/readiness'

const EFFORT_STYLE: Record<string, string> = {
  low: 'bg-reconciled/15 text-reconciled',
  medium: 'bg-break/15 text-break',
  scoping: 'bg-error-container text-error'
}
const EFFORT_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', scoping: 'Scoping' }

function scoreTone(score: number): string {
  if (score >= 85) return 'text-reconciled'
  if (score >= 65) return 'text-break'
  return 'text-error'
}

export function ReadinessDigestView({
  digest,
  input,
  onRevise,
  savedProfile
}: {
  digest: ReadinessDigest
  input: ReadinessAssessmentInput
  onRevise: () => void
  savedProfile: ReadinessProfile | null
}) {
  const blockers = digest.governance.filter((g) => g.blocker)

  return (
    <section className="space-y-6" data-testid="readiness-digest">
      {/* Score + verdict */}
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-6">
          <div className="text-center">
            <div className={`text-5xl font-bold ${scoreTone(digest.score)}`} data-testid="readiness-score">
              {digest.score}
            </div>
            <div className="text-xs font-semibold uppercase tracking-widest text-on-surface-variant">readiness</div>
          </div>
          <div className="flex-1 min-w-64">
            <h2 className="text-lg font-semibold">{digest.verdict}</h2>
            <p className="mt-1 text-sm text-on-surface-variant">{digest.already_done.note}</p>
          </div>
        </div>
      </div>

      {/* Per-port table */}
      <Card title="Per-port readiness">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-outline-variant text-left text-xs uppercase tracking-wide text-on-surface-variant">
                <th className="px-4 py-2">Port</th>
                <th className="px-4 py-2">Chosen system</th>
                <th className="px-4 py-2">Adapter</th>
                <th className="px-4 py-2">Effort</th>
                <th className="px-4 py-2">Contract-test gate</th>
              </tr>
            </thead>
            <tbody>
              {digest.ports.map((p) => (
                <tr key={p.id} className="border-b border-outline-variant/60" data-testid={`digest-port-${p.id}`}>
                  <td className="px-4 py-2 font-semibold">
                    <span className="mr-1.5 font-mono text-xs text-on-surface-variant">{p.id}</span>
                    {p.name}
                  </td>
                  <td className="px-4 py-2">{p.chosen_system}</td>
                  <td className="px-4 py-2">
                    {p.adapter_status === 'sim_ready' ? (
                      <span className="rounded-full bg-reconciled/15 px-2 py-0.5 text-xs font-semibold text-reconciled">no work</span>
                    ) : (
                      <span className="rounded-full bg-surface-container px-2 py-0.5 text-xs font-semibold text-on-surface-variant">to write</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${EFFORT_STYLE[p.effort_band] ?? 'bg-surface-container text-on-surface-variant'}`}>
                      {EFFORT_LABEL[p.effort_band] ?? p.effort_band}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-on-surface-variant">{p.contract_test_gate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Decisions to close */}
      {blockers.length > 0 && (
        <Card title="Decisions to close before go-live">
          <ul className="space-y-2 p-4">
            {blockers.map((g) => (
              <li key={g.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-xs text-on-surface-variant">{g.id}</span>
                <span className="font-semibold">{g.title}</span>
                <span className="rounded-full bg-break/15 px-2 py-0.5 text-xs font-semibold text-break">blocks {g.blocker}</span>
                <span className="text-on-surface-variant">— {g.is_default ? 'on default' : `set: ${g.answer}`}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Sequencing */}
      <Card title="Suggested port-swap sequence (M6)">
        <ol className="space-y-2 p-4">
          {digest.sequencing.map((s) => (
            <li key={s.step} className="flex gap-3 text-sm" data-testid={`seq-step-${s.step}`}>
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-on-secondary">
                {s.step}
              </span>
              <span>
                <span className="font-semibold">{s.port} — {s.system}.</span> <span className="text-on-surface-variant">{s.action}</span>
              </span>
            </li>
          ))}
          {digest.sequencing.length === 0 && (
            <li className="text-sm text-on-surface-variant">Nothing to swap — every chosen surface is built-in or declined.</li>
          )}
        </ol>
      </Card>

      {/* Generated Bank Profile */}
      <Card title="Generated Bank Profile (enterprise)">
        <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-on-surface" data-testid="generated-profile">
          {Object.entries(digest.generated_profile)
            .map(([k, v]) => `${k} = ${v}`)
            .join('\n')}
        </pre>
      </Card>

      <SaveAndShare input={input} savedProfile={savedProfile} digest={digest} onRevise={onRevise} />
    </section>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
      <div className="border-b border-outline-variant px-4 py-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-primary">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function SaveAndShare({
  input,
  savedProfile,
  digest,
  onRevise
}: {
  input: ReadinessAssessmentInput
  savedProfile: ReadinessProfile | null
  digest: ReadinessDigest
  onRevise: () => void
}) {
  const [name, setName] = useState(savedProfile?.name ?? '')
  const [slug, setSlug] = useState<string | null>(savedProfile?.slug ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const shareUrl = slug && typeof window !== 'undefined' ? `${window.location.origin}/readiness?profile=${slug}` : null

  async function save() {
    if (!name.trim()) {
      setError('Give the profile a name first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/readiness/profiles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, input })
      })
      const body = (await res.json()) as ReadinessProfile & { error?: { message?: string } }
      if (!res.ok) throw new Error(body.error?.message ?? 'Save failed.')
      setSlug(body.slug)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setBusy(false)
    }
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify({ name, input, digest }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `readiness-${name.trim().replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'profile'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card title="Save, share & export">
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-56 text-sm">
            <span className="mb-1 block font-semibold">Profile name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="profile-name"
              maxLength={120}
              placeholder="e.g. Bank A — Open Finance pilot"
              className="w-full rounded-md border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm focus:border-secondary focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            data-testid="save-profile"
            className="rounded-lg bg-secondary px-4 py-2 text-sm font-bold text-on-secondary transition-colors hover:bg-secondary-container disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Save & get share link'}
          </button>
        </div>

        {error && <p className="text-sm text-error" data-testid="save-error">{error}</p>}

        {shareUrl && (
          <div className="rounded-lg border border-reconciled/30 bg-reconciled/10 px-3 py-2 text-sm" data-testid="share-link">
            <span className="font-semibold text-reconciled">Saved.</span> Share or reopen at{' '}
            <a href={shareUrl} className="break-all font-mono text-secondary hover:underline">
              {shareUrl}
            </a>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" onClick={() => window.print()} className="rounded-md border border-outline-variant px-3 py-1.5 text-sm font-semibold hover:bg-surface-container">
            Print / Save as PDF
          </button>
          <button type="button" onClick={downloadJson} data-testid="download-json" className="rounded-md border border-outline-variant px-3 py-1.5 text-sm font-semibold hover:bg-surface-container">
            Download digest (JSON)
          </button>
          <button type="button" onClick={onRevise} className="rounded-md border border-outline-variant px-3 py-1.5 text-sm font-semibold hover:bg-surface-container">
            Revise answers
          </button>
        </div>
      </div>
    </Card>
  )
}
