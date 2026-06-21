/**
 * UX-09b — a point-of-action audit affordance. The audit assurance lived only on the
 * dashboard / care lookup; this makes operator accountability visible right where
 * consequential actions are taken (revoke, escalate, resolve, approve/reject, invoice).
 * Display-only — the actual INSERT-only High-class audit is emitted server-side. Token-only.
 */
export function AuditNote({ className = '' }: { className?: string }) {
  return (
    <p className={`text-xs text-on-surface-variant flex items-center gap-1 ${className}`} data-testid="audit-note">
      <span className="font-symbols text-sm" aria-hidden>
        lock
      </span>
      Actions here are recorded to the immutable audit trail.
    </p>
  )
}
