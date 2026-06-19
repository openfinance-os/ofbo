import { RESOLVE_OUTCOMES, MIN_RESOLUTION_NOTE, formatMoney, type ReconciliationBreak, type ReconciliationRun } from '../lib/reconciliation'

/**
 * UI-03 — Reconciliation Console, translated from the Stitch "OFBO - Reconciliation
 * Console (Refined)" screen (project 8050269076066130289). Presentational + server-
 * rendered: KPI cards for the selected run, the recent-run list, and the Break Queue
 * (claim → SLA clock → resolve). Token-only (no raw hex/px). DATA from the OpenAPI
 * contract via lib/reconciliation; appearance is the Stitch screen. Mutations are
 * server actions, injected so the unit renders without Next. consents NA — finance scope.
 */

export interface ReconConsoleProps {
  runs?: ReconciliationRun[]
  selectedRun?: ReconciliationRun | null
  breaks?: ReconciliationBreak[]
  error?: string | null
  notice?: string | null
  canWrite?: boolean
  claimAction?: (formData: FormData) => void | Promise<void>
  resolveAction?: (formData: FormData) => void | Promise<void>
}

/** Run status → tone (PRD §7 triad). Contract enum: running|completed|failed|partial. */
const RUN_TONE: Record<string, string> = {
  completed: 'bg-reconciled/10 text-reconciled',
  running: 'bg-secondary-fixed text-on-secondary-fixed',
  partial: 'bg-break/10 text-break',
  failed: 'bg-breach/10 text-breach'
}
/**
 * Break status → tone. Contract BreakStatus: flagged (new, claimable=amber), assigned
 * (claimed/in-progress=secondary), resolved_matched|resolved_internal_correction
 * (reconciled=green), escalated_nebras_dispute|escalated_fintech_billing (breach=red).
 */
const BREAK_TONE: Record<string, string> = {
  flagged: 'bg-break/10 text-break',
  assigned: 'bg-secondary-fixed text-on-secondary-fixed',
  resolved_matched: 'bg-reconciled/10 text-reconciled',
  resolved_internal_correction: 'bg-reconciled/10 text-reconciled',
  escalated_nebras_dispute: 'bg-breach/10 text-breach',
  escalated_fintech_billing: 'bg-breach/10 text-breach'
}
const CLAIMABLE = new Set(['flagged'])
const RESOLVABLE = new Set(['assigned'])

export function StatusBadge({ status, kind }: { status: string; kind: 'run' | 'break' }) {
  const tone = (kind === 'run' ? RUN_TONE : BREAK_TONE)[status] ?? 'bg-surface-container-high text-on-surface-variant'
  return (
    <span data-testid={`status-${status}`} className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${tone}`}>
      {status}
    </span>
  )
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 shadow-sm" data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <p className="text-xs text-on-surface-variant mb-1">{label}</p>
      <p className={`text-2xl font-bold ${tone ?? 'text-primary'}`}>{value}</p>
      {sub ? <p className="text-xs text-on-surface-variant mt-1">{sub}</p> : null}
    </div>
  )
}

export function KpiCards({ run }: { run: ReconciliationRun }) {
  const rate = run.line_count_total > 0 ? ((run.line_count_matched / run.line_count_total) * 100).toFixed(1) : '0.0'
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="kpi-cards">
      <Kpi label="Total Lines" value={run.line_count_total.toLocaleString('en-US')} sub={`${run.run_type} · ${run.status}`} />
      <Kpi label="Matched" value={run.line_count_matched.toLocaleString('en-US')} sub={`${rate}% success rate`} tone="text-reconciled" />
      <Kpi label="Unmatched" value={run.line_count_unmatched.toLocaleString('en-US')} sub={run.line_count_unmatched > 0 ? 'Action required' : 'Clear'} tone={run.line_count_unmatched > 0 ? 'text-breach' : 'text-primary'} />
      <Kpi label="Disputed" value={run.line_count_disputed.toLocaleString('en-US')} sub="Nebras-linked" tone="text-break" />
    </div>
  )
}

export function RunList({ runs, selectedId }: { runs: ReconciliationRun[]; selectedId?: string }) {
  return (
    <section aria-labelledby="run-list-heading" className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm" data-testid="run-list">
      <div className="px-4 py-3 border-b border-outline-variant">
        <h2 id="run-list-heading" className="font-bold text-sm text-primary uppercase tracking-widest">Reconciliation Runs</h2>
      </div>
      <ul className="divide-y divide-outline-variant">
        {runs.length === 0 ? (
          <li className="p-4 text-xs text-on-surface-variant" data-testid="runs-empty">
            No reconciliation runs.
          </li>
        ) : (
          runs.map((r) => (
            <li key={r.id} data-testid={`run-${r.run_id}`}>
              <a href={`/reconciliation?run_id=${encodeURIComponent(r.run_id)}`} aria-current={r.run_id === selectedId ? 'true' : undefined} className={`flex items-center justify-between gap-3 p-4 hover:bg-surface-container-low transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset ${r.run_id === selectedId ? 'bg-surface-container-low' : ''}`}>
                <div className="min-w-0">
                  <p className="font-mono text-xs text-primary truncate">{r.run_id}</p>
                  <p className="text-xs text-on-surface-variant">{r.created_at}</p>
                </div>
                <StatusBadge status={r.status} kind="run" />
              </a>
            </li>
          ))
        )}
      </ul>
    </section>
  )
}

function ResolveForm({ breakId, runId, resolveAction }: { breakId: string; runId: string; resolveAction?: ReconConsoleProps['resolveAction'] }) {
  if (!resolveAction) return null
  return (
    <form action={resolveAction} data-testid={`resolve-form-${breakId}`} className="mt-3 space-y-2 border-t border-outline-variant pt-3">
      <input type="hidden" name="break_id" value={breakId} />
      <input type="hidden" name="run_id" value={runId} />
      <select name="resolution_outcome" aria-label="resolution outcome" className="w-full bg-surface-container text-xs border border-outline-variant rounded px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        {RESOLVE_OUTCOMES.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <textarea
        name="resolution_note"
        aria-label="resolution note"
        minLength={MIN_RESOLUTION_NOTE}
        required
        placeholder={`Resolution note (≥ ${MIN_RESOLUTION_NOTE} chars)…`}
        className="w-full bg-surface-container-lowest text-xs border border-outline-variant rounded px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
      <button type="submit" className="w-full bg-reconciled text-on-error py-1.5 rounded text-xs font-bold hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
        Resolve break
      </button>
    </form>
  )
}

export function BreakCard({ b, canWrite, claimAction, resolveAction }: { b: ReconciliationBreak; canWrite?: boolean; claimAction?: ReconConsoleProps['claimAction']; resolveAction?: ReconConsoleProps['resolveAction'] }) {
  return (
    <div className="p-3 border border-outline-variant rounded-lg bg-surface-container-low border-l-4 border-l-break" data-testid={`break-${b.id}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-bold text-primary truncate">{b.client_id}</span>
        <StatusBadge status={b.status} kind="break" />
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-xs text-on-surface-variant uppercase">{b.line_type}</span>
        <span className="font-mono text-xs font-bold text-breach" data-testid={`variance-${b.id}`}>
          {b.variance_amount ? formatMoney(b.variance_amount) : b.variance_count != null ? `${b.variance_count} count` : '—'}
        </span>
      </div>
      {/* three-way source refs (Nebras / platform / fintech) */}
      <div className="grid grid-cols-3 gap-1 mt-2 text-xs font-mono text-on-surface-variant">
        <span className="truncate" title="Nebras">A:{b.source_a_ref ?? '—'}</span>
        <span className="truncate" title="Platform">B:{b.source_b_ref ?? '—'}</span>
        <span className="truncate" title="Fintech">C:{b.source_c_ref ?? '—'}</span>
      </div>
      <p className="text-xs text-on-surface-variant mt-2">
        {b.assigned_to ? `Assignee: ${b.assigned_to}` : 'Unassigned'}
        {b.sla_clock_started_at ? ` · SLA started ${b.sla_clock_started_at}` : ''}
        {b.reopened_count > 0 ? ` · reopened ×${b.reopened_count}` : ''}
      </p>
      <a href={`/reconciliation/breaks/${encodeURIComponent(b.id)}`} data-testid={`investigate-${b.id}`} aria-label={`Investigate break ${b.client_id}`} className="mt-2 inline-block text-xs text-secondary hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        Investigate →
      </a>
      {canWrite && CLAIMABLE.has(b.status) && claimAction ? (
        <form action={claimAction} data-testid={`claim-form-${b.id}`} className="mt-3">
          <input type="hidden" name="break_id" value={b.id} />
          <input type="hidden" name="run_id" value={b.run_id} />
          <button type="submit" className="w-full bg-secondary text-on-secondary py-1.5 rounded text-xs font-bold hover:bg-secondary-container transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
            Claim break
          </button>
        </form>
      ) : null}
      {canWrite && RESOLVABLE.has(b.status) ? <ResolveForm breakId={b.id} runId={b.run_id} resolveAction={resolveAction} /> : null}
    </div>
  )
}

export function BreakQueue({ breaks, canWrite, claimAction, resolveAction }: { breaks: ReconciliationBreak[]; canWrite?: boolean; claimAction?: ReconConsoleProps['claimAction']; resolveAction?: ReconConsoleProps['resolveAction'] }) {
  return (
    <section aria-labelledby="break-queue-heading" className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm" data-testid="break-queue">
      <div className="px-4 py-3 border-b border-outline-variant flex items-center gap-2">
        <h2 id="break-queue-heading" className="font-bold text-sm text-primary uppercase tracking-widest">Break Queue</h2>
        <span aria-hidden="true" className="bg-error-container text-on-error-container px-2 py-0.5 rounded-full text-xs font-bold">{breaks.length}</span>
        <span className="sr-only">{breaks.length} open breaks</span>
      </div>
      <div className="p-3 space-y-3">
        {breaks.length === 0 ? (
          <p className="text-xs text-on-surface-variant" data-testid="breaks-empty">
            No open breaks. 🎉
          </p>
        ) : (
          breaks.map((b) => <BreakCard key={b.id} b={b} canWrite={canWrite} claimAction={claimAction} resolveAction={resolveAction} />)
        )}
      </div>
    </section>
  )
}

export function ReconConsole({ runs = [], selectedRun, breaks = [], error, notice, canWrite, claimAction, resolveAction }: ReconConsoleProps) {
  return (
    <div className="space-y-6" data-testid="recon-console">
      <h1 className="text-2xl font-semibold">{selectedRun ? 'Reconciliation Run' : 'Reconciliation Console'}</h1>

      {notice ? (
        <p role="status" className="bg-reconciled/10 text-reconciled text-sm px-4 py-3 rounded-lg" data-testid="recon-notice">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="bg-error-container text-on-error-container text-sm px-4 py-3 rounded-lg" data-testid="recon-error">
          {error}
        </p>
      ) : null}

      {selectedRun ? <KpiCards run={selectedRun} /> : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <RunList runs={runs} selectedId={selectedRun?.run_id} />
        </div>
        <BreakQueue breaks={breaks} canWrite={canWrite} claimAction={claimAction} resolveAction={resolveAction} />
      </div>
    </div>
  )
}
