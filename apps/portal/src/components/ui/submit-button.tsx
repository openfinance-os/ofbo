'use client'

import { useFormStatus } from 'react-dom'
import type { ReactNode } from 'react'

/**
 * UX-05 — a submit button that reflects the in-flight server action. The portal is
 * all-server-rendered with redirect-per-mutation, so without this a submit gives no
 * feedback and a cold/free-tier BFF invites a double-submit. useFormStatus disables the
 * button + shows a pending label while its enclosing <form> is submitting. Token-only.
 */
export function SubmitButton({
  children,
  pendingLabel = 'Working…',
  className = '',
  testid,
  disabled = false,
  title
}: {
  children: ReactNode
  pendingLabel?: string
  className?: string
  testid?: string
  /**
   * BILL-17 — additive. Some actions are unavailable for a REASON the page can state (a period
   * still carrying open breaks, a payable with no four-eyes approval yet). Rendering the control
   * disabled with that reason beside it is more legible than hiding it, which leaves the operator
   * looking for a button that is not there. OR'd with `pending` so in-flight still disables.
   */
  disabled?: boolean
  title?: string
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      data-testid={testid}
      {...(title ? { title } : {})}
      className={`${className} disabled:opacity-60 disabled:cursor-not-allowed`}
    >
      {pending ? pendingLabel : children}
    </button>
  )
}
