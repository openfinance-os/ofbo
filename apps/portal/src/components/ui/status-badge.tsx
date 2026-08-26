/**
 * UX-01 — the canonical status→tone vocabulary. The UI/UX review found the status badge
 * re-implemented in 5 consoles with DIVERGENT maps (e.g. `suspended` red on analytics but
 * amber on care). This is the single source of truth (the analytics map was the most
 * complete). New screens should use `StatusBadge`; existing screens point their local maps
 * here so the colour vocabulary can never drift again. Token-only (no raw hex/px).
 *
 * FOUR states, not three (ADR 0033): breach=red, aging=amber, awaiting=slate,
 * reconciled=green, plus neutral. `aging` and `awaiting` are deliberately separate —
 * "running out of clock" is the owner's problem, "parked on a counterparty" is not, and
 * one amber for both hides which queue an operator should actually work. They shared the
 * amber for a release after the split because this map was never repointed; a state that
 * no map references is a state the UI does not have.
 */

const STATUS_TONE: Record<string, string> = {
  breach: 'bg-breach/10 text-breach', breached: 'bg-breach/10 text-breach', critical: 'bg-breach/10 text-breach', high: 'bg-breach/10 text-breach',
  rejected: 'bg-breach/10 text-breach', failed: 'bg-breach/10 text-breach', error: 'bg-breach/10 text-breach', down: 'bg-breach/10 text-breach',
  suspended: 'bg-aging/10 text-aging', overdue: 'bg-breach/10 text-breach', rjct: 'bg-breach/10 text-breach', revoked: 'bg-breach/10 text-breach',
  break: 'bg-aging/10 text-aging', warn: 'bg-aging/10 text-aging', warning: 'bg-aging/10 text-aging', at_risk: 'bg-aging/10 text-aging',
  degraded: 'bg-aging/10 text-aging', medium: 'bg-aging/10 text-aging', dual_running_required: 'bg-aging/10 text-aging',
  pending: 'bg-aging/10 text-aging', pdng: 'bg-aging/10 text-aging',
  // Waiting on someone else — slate, never the amber that means "your clock is running"
  // and never the accent that means "act here" (ADR 0033, THE ACCENT RULE). Scoped to the
  // states the ADR actually split; whether `pending`/`pdng` belong here too is a semantic
  // call the ADR does not make, so they stay amber until someone decides it on purpose.
  awaiting: 'bg-awaiting/10 text-awaiting', awaitingauthorization: 'bg-awaiting/10 text-awaiting',
  awaiting_authorization: 'bg-awaiting/10 text-awaiting',
  reconciled: 'bg-reconciled/10 text-reconciled', matched: 'bg-reconciled/10 text-reconciled', healthy: 'bg-reconciled/10 text-reconciled',
  up: 'bg-reconciled/10 text-reconciled', ok: 'bg-reconciled/10 text-reconciled', active: 'bg-reconciled/10 text-reconciled', authorized: 'bg-reconciled/10 text-reconciled',
  resolved: 'bg-reconciled/10 text-reconciled', approved: 'bg-reconciled/10 text-reconciled', passed: 'bg-reconciled/10 text-reconciled',
  registered: 'bg-reconciled/10 text-reconciled', acsp: 'bg-reconciled/10 text-reconciled', accc: 'bg-reconciled/10 text-reconciled',
  unknown: 'bg-surface-container text-on-surface-variant', none: 'bg-surface-container text-on-surface-variant',
  info: 'bg-surface-container text-on-surface-variant', low: 'bg-surface-container text-on-surface-variant',
  draft: 'bg-surface-container text-on-surface-variant', directory_only: 'bg-surface-container text-on-surface-variant', dormant: 'bg-surface-container text-on-surface-variant',
  consumed: 'bg-surface-container-high text-on-surface-variant', expired: 'bg-surface-container-high text-on-surface-variant'
}

const NEUTRAL = 'bg-surface-container-high text-on-surface-variant'

/** Canonical tone for a status token, or null if unrecognised (so arbitrary ids stay plain). */
export function statusTone(s: string): string | null {
  return STATUS_TONE[s.trim().toLowerCase().replace(/\s+/g, '_')] ?? STATUS_TONE[s.trim().toLowerCase().replace(/\s+/g, '')] ?? null
}

/** Canonical tone with a neutral fallback (for badges that always render a chip). */
export function statusToneOrNeutral(s: string): string {
  return statusTone(s) ?? NEUTRAL
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span data-testid={`status-${status}`} className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${statusToneOrNeutral(status)}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}
