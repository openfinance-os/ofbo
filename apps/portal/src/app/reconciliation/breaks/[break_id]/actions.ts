'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { TOKEN_COOKIE } from '../../../../lib/cookies'
import { verifyAndMint } from '../../../../lib/portal'
import { escalateToNebras } from '../../../../lib/reconciliation'

/**
 * UI-04 — Investigation Detail mutation (server action). SERVER-SIDE only: the httpOnly
 * session cookie → Bearer never reaches the browser. Re-verifies the session through the
 * IdP port and re-checks finance:disputes:write (defence in depth — the BFF re-enforces).
 * The escalation is mutating → a fresh Idempotency-Key per call.
 */

const DISPUTE_SCOPE = 'finance:disputes:write'

export async function escalateNebrasAction(formData: FormData) {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value
  if (!token) redirect('/')
  let principal
  try {
    principal = await verifyAndMint(token)
  } catch {
    redirect('/')
  }
  const breakId = String(formData.get('break_id') ?? '')
  if (!principal.superadmin && !principal.scopes.includes(DISPUTE_SCOPE)) redirect(`/reconciliation/breaks/${breakId}`)

  let status = 'escalated'
  try {
    await escalateToNebras(token, breakId, crypto.randomUUID())
  } catch {
    status = 'escalate_failed'
  }
  redirect(`/reconciliation/breaks/${encodeURIComponent(breakId)}?status=${status}`)
}
