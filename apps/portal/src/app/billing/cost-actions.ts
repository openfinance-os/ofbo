'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { TOKEN_COOKIE } from '../../lib/cookies'
import { SCOPES } from '../../lib/scopes'
import { verifyAndMint } from '../../lib/portal'
import { idempotencyKey } from '../../lib/idempotency'
import { dispatchPayable, requestCostPeriodClose, TppCostApiError } from '../../lib/tpp-cost'
import type { TppCostWriteResult } from '../../lib/tpp-cost-actions'

/**
 * BILL-17 — TPP Cost Management mutations (server actions).
 *
 * SERVER-SIDE only: the httpOnly session cookie becomes a Bearer that never reaches the browser.
 * Each re-verifies the session and re-checks the §2 scope — defence in depth; the BFF re-enforces.
 *
 * Both actions RETURN their failure rather than redirecting. The refusals here are the payable
 * controls speaking — an unresolved break blocking a close, an approval that does not authorise
 * this caller — and a redirect would replace a specific, actionable message with a page that
 * appeared to do nothing.
 */

function costFailure(e: unknown, fallback: string): TppCostWriteResult {
  if (e instanceof TppCostApiError) {
    return { ok: false, error: e.message, remediation: e.remediation ?? null, docsUrl: e.docsUrl ?? null }
  }
  return { ok: false, error: fallback }
}

async function tokenOrBounce(required: string): Promise<string> {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value
  if (!token) redirect('/')
  let principal
  try {
    principal = await verifyAndMint(token)
  } catch {
    redirect('/')
  }
  if (!principal.superadmin && !principal.scopes.includes(required)) redirect('/billing')
  return token
}

/**
 * Four-eyes: this REQUESTS the close and returns `202` + an approval request. The period closes
 * only when a second finance principal approves, so the success path links to the approvals queue
 * rather than claiming the period is shut.
 */
export async function requestCostCloseAction(
  _prev: TppCostWriteResult,
  formData: FormData
): Promise<TppCostWriteResult> {
  const token = await tokenOrBounce(SCOPES.reconciliationWrite)
  const period = String(formData.get('period') ?? '')
  let approvalRequestId: string
  try {
    const result = await requestCostPeriodClose(token, period, idempotencyKey(formData))
    approvalRequestId = result.approval_request_id
  } catch (e) {
    return costFailure(e, 'Could not request the cost-period close. Please retry.')
  }
  // UX-03 — carry the approval id so the initiator can follow it to the queue instead of being
  // told "submitted" with nothing to click.
  redirect(`/billing?period=${encodeURIComponent(period)}&ar=${encodeURIComponent(approvalRequestId)}`)
}

/** Authorises HONOURING the scheme direct debit. Never a push payment (IG v5.0 §10.14–10.15). */
export async function dispatchPayableAction(
  _prev: TppCostWriteResult,
  formData: FormData
): Promise<TppCostWriteResult> {
  const token = await tokenOrBounce(SCOPES.reconciliationWrite)
  const payableId = String(formData.get('payable_id') ?? '')
  try {
    await dispatchPayable(token, payableId, idempotencyKey(formData))
  } catch (e) {
    return costFailure(e, 'Could not dispatch the payable. Please retry.')
  }
  redirect('/billing?dispatched=1')
}
