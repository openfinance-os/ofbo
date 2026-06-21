'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { TOKEN_COOKIE } from '../../lib/cookies'
import { verifyAndMint } from '../../lib/portal'
import { approveRequest, rejectRequest, ApprovalApiError, type ApprovalWriteResult } from '../../lib/approvals'
import { idempotencyKey } from '../../lib/idempotency'

/**
 * UX-06c — on failure an approvals write action RETURNS an ApprovalWriteResult (no redirect) so
 * the form re-renders in place with the typed BFF error (message + remediation + docs_url) AND
 * keeps the operator's inputs (the reject reason). Success still redirect()s.
 */
function approvalFailure(e: unknown, fallback: string, values: Record<string, string>): ApprovalWriteResult {
  if (e instanceof ApprovalApiError) {
    return { ok: false, error: e.message, remediation: e.remediation ?? null, docsUrl: e.docsUrl ?? null, values }
  }
  return { ok: false, error: fallback, values }
}

/**
 * UI-05 — Four-Eyes Approval Portal mutations (server actions). SERVER-SIDE only: the
 * httpOnly session cookie → Bearer never reaches the browser. The BFF enforces four-eyes
 * (initiator ≠ approver, approver scope) and executes the gated operation on approval —
 * the portal NEVER executes inline. Mutating calls carry a fresh Idempotency-Key.
 */

async function tokenOrBounce() {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value
  if (!token) redirect('/')
  try {
    await verifyAndMint(token)
  } catch {
    redirect('/')
  }
  return token
}

export async function approveAction(_prevState: ApprovalWriteResult, formData: FormData): Promise<ApprovalWriteResult> {
  const token = await tokenOrBounce()
  const approvalId = String(formData.get('approval_id') ?? '')
  try {
    await approveRequest(token, approvalId, idempotencyKey(formData))
  } catch (e) {
    return approvalFailure(e, 'Could not approve the request. Please retry.', {})
  }
  redirect('/approvals?status=approved')
}

export async function rejectAction(_prevState: ApprovalWriteResult, formData: FormData): Promise<ApprovalWriteResult> {
  const token = await tokenOrBounce()
  const approvalId = String(formData.get('approval_id') ?? '')
  const reason = String(formData.get('reject_reason') ?? '')
  try {
    await rejectRequest(token, approvalId, reason, idempotencyKey(formData))
  } catch (e) {
    // Preserve the typed reject reason for the retry.
    return approvalFailure(e, 'Could not reject the request. Please retry.', { reject_reason: reason })
  }
  redirect('/approvals?status=rejected')
}
