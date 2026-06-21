/**
 * UX-01 — the canonical status→tone vocabulary. The UI/UX review found the status badge
 * re-implemented in 5 consoles with DIVERGENT maps (e.g. `suspended` red on analytics but
 * amber on care). This is the single source of truth (the analytics map was the most
 * complete). New screens should use `StatusBadge`; existing screens point their local maps
 * here so the colour vocabulary can never drift again. Status triad per PRD §7
 * (breach=red, break=amber, reconciled=green) + neutral. Token-only (no raw hex/px).
 */

const STATUS_TONE: Record<string, string> = {
  breach: 'bg-breach/10 text-breach', breached: 'bg-breach/10 text-breach', critical: 'bg-breach/10 text-breach', high: 'bg-breach/10 text-breach',
  rejected: 'bg-breach/10 text-breach', failed: 'bg-breach/10 text-breach', error: 'bg-breach/10 text-breach', down: 'bg-breach/10 text-breach',
  suspended: 'bg-break/10 text-break', overdue: 'bg-breach/10 text-breach', rjct: 'bg-breach/10 text-breach', revoked: 'bg-breach/10 text-breach',
  break: 'bg-break/10 text-break', warn: 'bg-break/10 text-break', warning: 'bg-break/10 text-break', at_risk: 'bg-break/10 text-break',
  degraded: 'bg-break/10 text-break', awaiting: 'bg-break/10 text-break', awaitingauthorization: 'bg-break/10 text-break', pending: 'bg-break/10 text-break', medium: 'bg-break/10 text-break',
  dual_running_required: 'bg-break/10 text-break', pdng: 'bg-break/10 text-break',
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
