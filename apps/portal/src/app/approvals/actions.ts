'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { TOKEN_COOKIE } from '../../lib/cookies'
import { verifyAndMint } from '../../lib/portal'
import { approveRequest, rejectRequest } from '../../lib/approvals'

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

export async function approveAction(formData: FormData) {
  const token = await tokenOrBounce()
  const approvalId = String(formData.get('approval_id') ?? '')
  let status = 'approved'
  try {
    await approveRequest(token, approvalId, crypto.randomUUID())
  } catch {
    status = 'approve_failed'
  }
  redirect(`/approvals?status=${status}`)
}

export async function rejectAction(formData: FormData) {
  const token = await tokenOrBounce()
  const approvalId = String(formData.get('approval_id') ?? '')
  const reason = String(formData.get('reject_reason') ?? '')
  let status = 'rejected'
  try {
    await rejectRequest(token, approvalId, reason, crypto.randomUUID())
  } catch {
    status = 'reject_failed'
  }
  redirect(`/approvals?status=${status}`)
}
