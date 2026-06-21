import { ESCALATABLE_STATES, formatMoney, type ReconciliationBreak } from '../lib/reconciliation'
import { StatusBadge } from './recon-console'
import { ConfirmSubmit } from './ui'

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
  escalateAction?: (formData: FormData) => void | Promise<void>
}

const SOURCES: { key: 'source_a_ref' | 'source_b_ref' | 'source_c_ref'; label: string; hint: string }[] = [
  { key: 'source_a_ref', label: 'A · Nebras Billing', hint: 'What Nebras billed' },
  { key: 'source_b_ref', label: 'B · Bank Platform', hint: 'Metering of record (call count + success)' },
  { key: 'source_c_ref', label: 'C · Fintech Billing', hint: 'Downstream pass-through' }
]

function SourceCard({ label, hint, value }: { label: string; hint: string; value: string | null }) {
  const present = value != null && value !== ''
  return (
    <div className={`rounded-xl border p-4 ${present ? 'border-outline-variant bg-surface-container-lowest' : 'border-l-4 border-l-breach border-outline-variant bg-error-container/10'}`} data-testid={`source-${label[0]}`}>
      <p className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">{label}</p>
      <p className="font-mono text-sm text-primary mt-2 break-all">{present ? value : 'MISSING'}</p>
      <p className="text-xs text-on-surface-variant mt-2">{hint}</p>
    </div>
  )
}

export function ThreeSourceDiff({ break_ }: { break_: ReconciliationBreak }) {
  return (
    <section data-testid="three-source-diff" aria-labelledby="three-way-heading">
      <h2 id="three-way-heading" className="font-bold text-sm text-primary uppercase tracking-widest mb-3">Three-Way Comparison</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {SOURCES.map((s) => (
          <SourceCard key={s.key} label={s.label} hint={s.hint} value={break_[s.key]} />
        ))}
      </div>
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
          <form action={escalateAction} className="mt-3" data-testid="escalate-form">
            <input type="hidden" name="break_id" value={break_.id} />
            <ConfirmSubmit
              label="Escalate to Nebras"
              confirmLabel="Confirm escalation"
              summary={`Raise a Nebras dispute for break ${break_.client_id}${break_.variance_amount ? ` (${formatMoney(break_.variance_amount)})` : ''}. This creates an external case via the egress gateway and cannot be undone.`}
              className="bg-breach text-on-error px-4 py-2 rounded-lg text-xs font-bold hover:bg-error transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              testid="escalate-submit"
            />
          </form>
        ) : null}
      </div>
    </div>
  )
}
