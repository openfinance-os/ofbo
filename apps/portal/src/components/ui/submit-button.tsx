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
  testid
}: {
  children: ReactNode
  pendingLabel?: string
  className?: string
  testid?: string
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      data-testid={testid}
      className={`${className} disabled:opacity-60 disabled:cursor-not-allowed`}
    >
      {pending ? pendingLabel : children}
    </button>
  )
}
