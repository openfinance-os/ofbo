'use client'

import { useState, type ReactNode } from 'react'

/**
 * UX-02 — a two-step, accessible confirmation for an irreversible / externally-visible
 * submit (consent revoke, escalate-to-Nebras, approve-gated-op). The action button is
 * type="button" until armed; arming reveals a plain-language summary of what will happen
 * plus a real type="submit" "Confirm" and a "Cancel". Because Confirm submits the enclosing
 * <form>, native constraint validation (e.g. a required reason select) still runs before
 * dispatch. Real buttons + a labelled group (not a native confirm() dialog) keep it
 * keyboard- and screen-reader-accessible. Token-only (no raw hex/px).
 */
export function ConfirmSubmit({
  label,
  summary,
  confirmLabel = 'Confirm',
  className = '',
  testid
}: {
  label: ReactNode
  summary: string
  confirmLabel?: string
  className?: string
  testid?: string
}) {
  const [armed, setArmed] = useState(false)

  if (!armed) {
    return (
      <button type="button" onClick={() => setArmed(true)} data-testid={testid} className={className}>
        {label}
      </button>
    )
  }

  return (
    <div role="group" aria-label="Confirm action" data-testid={testid ? `${testid}-armed` : undefined} className="space-y-2">
      <p className="text-xs text-on-surface-variant">{summary}</p>
      <div className="flex gap-2">
        <button type="submit" data-testid={testid ? `${testid}-confirm` : undefined} className={className}>
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={() => setArmed(false)}
          data-testid={testid ? `${testid}-cancel` : undefined}
          className="px-3 py-1.5 rounded text-xs font-medium border border-outline-variant text-on-surface-variant hover:bg-surface-container"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
