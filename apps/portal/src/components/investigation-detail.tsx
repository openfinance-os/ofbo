import { ESCALATABLE_STATES, formatMoney, type ReconciliationBreak, type ReconWriteResult } from '../lib/reconciliation'
import { StatusBadge } from './recon-console'
import { EscalateForm } from './reconciliation/escalate-form'

/**
 * UI-04 — Investigation Detail View, translated from the Stitch "OFBO - Investigation
 * Detail View" screen (project 8050269076066130289). Presentational + server-rendered:
 * the BACKOFFICE-11 three-source side-by-side diff (A = Nebras billing, B = bank platform
 * metering-of-record, C = downstream fintech billing) for one break, plus the BACKOFFICE-05
 * one-click Nebras dispute escalation. Token-only (no raw hex/px). DATA from the OpenAPI
 * contract via lib/reconciliation; appearance = the Stitch screen. Escalation is a server
 * action, injected so the unit renders without Next. Finance scope.
 */

export interface InvestigationDetailProps {
  break_: ReconciliationBreak
  error?: string | null
  notice?: string | null
  canDispute?: boolean
  escalateAction?: (prevState: ReconWriteResult, formData: FormData) => Promise<ReconWriteResult>
}

const SOURCES: { key: 'source_a_ref' | 'source_b_ref' | 'source_c_ref'; id: 'A' | 'B' | 'C'; label: string; hint: string }[] = [
  { key: 'source_a_ref', id: 'A', label: 'A · Nebras Billing', hint: 'What Nebras billed' },
  { key: 'source_b_ref', id: 'B', label: 'B · Bank Platform', hint: 'Metering of record (call count + success)' },
  { key: 'source_c_ref', id: 'C', label: 'C · Fintech Billing', hint: 'Downstream pass-through' }
]

function SourceCard({ id, label, hint, value }: { id: string; label: string; hint: string; value: string | null }) {
  const present = value != null && value !== ''
  return (
    <div className={`rounded-xl border p-4 ${present ? 'border-outline-variant bg-surface-container-lowest' : 'border-l-4 border-l-breach border-outline-variant bg-error-container/10'}`} data-testid={`source-${id}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">{label}</p>
        {present ? (
          <span className="font-symbols text-base text-reconciled" data-testid={`source-reconciled-${id}`} aria-label="reconciled">check_circle</span>
        ) : (
          <span className="font-symbols text-base text-breach" aria-hidden>error</span>
        )}
      </div>
      <p className={`font-mono text-sm mt-2 break-all ${present ? 'text-primary' : 'text-breach font-bold'}`}>{present ? value : 'MISSING'}</p>
      <p className="text-xs text-on-surface-variant mt-2">{hint}</p>
    </div>
  )
}

export function ThreeSourceDiff({ break_ }: { break_: ReconciliationBreak }) {
  const missing = SOURCES.filter((s) => !break_[s.key])
  const present = SOURCES.filter((s) => break_[s.key])
  const variance = break_.variance_amount ? formatMoney(break_.variance_amount) : break_.variance_count != null ? `${break_.variance_count} count` : '—'
  // UIF-09b — a data-honest summary derived from which source refs are present: the present
  // sources reconcile; a null ref IS the divergence (e.g. C missing = no downstream line).
  const summary =
    missing.length > 0 && present.length > 0
      ? `${present.map((s) => s.id).join(' = ')} reconcile · ${missing.map((s) => s.id).join(', ')} missing → break of `
      : missing.length === 0
        ? 'Amount mismatch across A · B · C → break of '
        : 'Sources unavailable → break of '
  return (
    <section data-testid="three-source-diff" aria-labelledby="three-way-heading">
      <h2 id="three-way-heading" className="font-bold text-sm text-primary uppercase tracking-widest mb-3">Three-Way Comparison</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {SOURCES.map((s) => (
          <SourceCard key={s.key} id={s.id} label={s.label} hint={s.hint} value={break_[s.key]} />
        ))}
      </div>
      <div data-testid="three-source-summary" className="mt-4 flex items-center gap-2 text-sm bg-surface-container rounded-lg px-4 py-2 text-on-surface-variant">
        <span className="font-symbols text-base shrink-0" aria-hidden>info</span>
        <span>
          {summary}
          <span className="text-breach font-bold font-mono">{variance}</span>
        </span>
      </div>
    </section>
  )
}

/**
 * UIF-09b — the break's audit-trail timeline (Stitch "Reconciliation Break Investigation
 * (Finance, Three-Source)"). Each node is derived from a break field — no fabricated
 * history: detection (created_at), assignment (assigned_to + SLA clock), escalation
 * (nebras_dispute_case_id, else "requested" while still escalatable), resolution.
 */
function AuditTrail({ break_ }: { break_: ReconciliationBreak }) {
  const escalatable = (ESCALATABLE_STATES as readonly string[]).includes(break_.status)
  const events: { label: string; at: string | null; tone: string }[] = [{ label: 'Break detected', at: break_.created_at, tone: 'bg-reconciled' }]
  if (break_.assigned_to) events.push({ label: `Assigned to ${break_.assigned_to}`, at: break_.sla_clock_started_at, tone: 'bg-reconciled' })
  if (break_.nebras_dispute_case_id) events.push({ label: `Escalated — Nebras case ${break_.nebras_dispute_case_id}`, at: null, tone: 'bg-break' })
  else if (escalatable) events.push({ label: 'Escalation requested', at: null, tone: 'bg-break' })
  if (break_.resolution_outcome) events.push({ label: `Resolved — ${break_.resolution_outcome}`, at: null, tone: 'bg-reconciled' })
  return (
    <section data-testid="audit-trail" aria-labelledby="audit-heading" className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4">
      <h2 id="audit-heading" className="font-bold text-sm text-primary uppercase tracking-widest mb-4">Audit Trail</h2>
      <ol className="space-y-4">
        {events.map((e, i) => (
          <li key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={`w-3 h-3 rounded-full shrink-0 ${e.tone}`} aria-hidden />
              {i < events.length - 1 ? <span className="w-px flex-1 bg-outline-variant mt-1" aria-hidden /> : null}
            </div>
            <div className="-mt-0.5 pb-1">
              <p className="text-sm font-semibold text-on-surface">{e.label}</p>
              {e.at ? <p className="font-mono text-xs text-on-surface-variant mt-0.5">{e.at}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function InvestigationDetail({ break_, error, notice, canDispute, escalateAction }: InvestigationDetailProps) {
  const escalatable = (ESCALATABLE_STATES as readonly string[]).includes(break_.status)
  return (
    <div className="space-y-6" data-testid="investigation-detail">
      <div className="flex items-center justify-between gap-3">
        <div>
          <nav aria-label="breadcrumb" className="text-xs text-on-surface-variant flex items-center gap-1" data-testid="breadcrumb">
            <a href="/reconciliation" className="text-secondary hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" data-testid="back-link">
              Reconciliation
            </a>
            <span aria-hidden="true">/</span>
            <span className="text-on-surface" aria-current="page">Break {break_.client_id}</span>
          </nav>
          <h1 className="text-2xl font-semibold mt-1">Investigation · {break_.client_id}</h1>
        </div>
        <StatusBadge status={break_.status} kind="break" />
      </div>

      {notice ? (
        <p role="status" className="bg-reconciled/10 text-reconciled text-sm px-4 py-3 rounded-lg" data-testid="investigation-notice">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="bg-error-container text-on-error-container text-sm px-4 py-3 rounded-lg" data-testid="investigation-error">
          {error}
        </p>
      ) : null}

      {/* Break summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="break-summary">
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4">
          <p className="text-xs text-on-surface-variant mb-1">Variance</p>
          <p className="text-xl font-bold text-breach font-mono">{break_.variance_amount ? formatMoney(break_.variance_amount) : break_.variance_count != null ? `${break_.variance_count} count` : '—'}</p>
        </div>
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4">
          <p className="text-xs text-on-surface-variant mb-1">Line Type</p>
          <p className="text-sm font-semibold text-primary uppercase mt-1">{break_.line_type}</p>
        </div>
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4">
          <p className="text-xs text-on-surface-variant mb-1">Assignee</p>
          <p className="text-sm font-semibold text-primary mt-1">{break_.assigned_to ?? 'Unassigned'}</p>
        </div>
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4">
          <p className="text-xs text-on-surface-variant mb-1">SLA Clock</p>
          <p className="text-sm font-semibold text-primary mt-1">{break_.sla_clock_started_at ?? 'Not started'}</p>
        </div>
      </div>

      <ThreeSourceDiff break_={break_} />

      {/* Escalation / dispute panel */}
      <div className="bg-surface-container-lowest border border-outline-variant border-l-4 border-l-break rounded-xl p-4" data-testid="escalation-panel">
        <h2 className="font-bold text-sm text-primary uppercase tracking-widest">Nebras Dispute</h2>
        {break_.nebras_dispute_case_id ? (
          <p className="text-sm text-on-surface-variant mt-2" data-testid="nebras-case">
            Escalated — Nebras case <span className="font-mono text-primary">{break_.nebras_dispute_case_id}</span>.
          </p>
        ) : (
          <p className="text-xs text-on-surface-variant mt-2">Raise a one-click dispute to the Nebras Case &amp; Dispute Management surface (via the egress gateway).</p>
        )}
        {canDispute && escalatable && !break_.nebras_dispute_case_id && escalateAction ? (
          <EscalateForm break_={break_} action={escalateAction} />
        ) : null}
      </div>

      <AuditTrail break_={break_} />
    </div>
  )
}
