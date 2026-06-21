'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { TOKEN_COOKIE } from '../../../../lib/cookies'
import { SCOPES } from '../../../../lib/scopes'
import { verifyAndMint } from '../../../../lib/portal'
import { escalateToNebras, ReconApiError, type ReconWriteResult } from '../../../../lib/reconciliation'

/**
 * UI-04 — Investigation Detail mutation (server action). SERVER-SIDE only: the httpOnly
 * session cookie → Bearer never reaches the browser. Re-verifies the session through the
 * IdP port and re-checks finance:disputes:write (defence in depth — the BFF re-enforces).
 * The escalation is mutating → a fresh Idempotency-Key per call.
 */

const DISPUTE_SCOPE = SCOPES.disputesWrite

export async function escalateNebrasAction(_prevState: ReconWriteResult, formData: FormData): Promise<ReconWriteResult> {
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

  // UX-06d — on failure return the typed error in place (no inputs to preserve); success redirects.
  try {
    await escalateToNebras(token, breakId, crypto.randomUUID())
  } catch (e) {
    if (e instanceof ReconApiError) {
      return { ok: false, error: e.message, remediation: e.remediation ?? null, docsUrl: e.docsUrl ?? null }
    }
    return { ok: false, error: 'Could not escalate to Nebras. Please retry.' }
  }
  redirect(`/reconciliation/breaks/${encodeURIComponent(breakId)}?status=escalated`)
}
