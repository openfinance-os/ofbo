'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { TOKEN_COOKIE } from '../../lib/cookies'
import { SCOPES } from '../../lib/scopes'
import { verifyAndMint } from '../../lib/portal'
import { createInvoiceRun, registerFinancialSystem, syncDirectory, TppBillingApiError, type TppWriteResult } from '../../lib/tpp-billing'
import { idempotencyKey } from '../../lib/idempotency'

/**
 * UX-06d — on failure a tpp write action RETURNS a TppWriteResult (no redirect) so the form
 * re-renders in place with the typed BFF error (message + remediation + docs_url) AND keeps the
 * operator's inputs. Success still redirect()s (invoice-run preserves the ?ar= approval link).
 */
function tppFailure(e: unknown, fallback: string, values: Record<string, string>): TppWriteResult {
  if (e instanceof TppBillingApiError) {
    return { ok: false, error: e.message, remediation: e.remediation ?? null, docsUrl: e.docsUrl ?? null, values }
  }
  return { ok: false, error: fallback, values }
}

/**
 * UI-08 — TPP Billing & Registry mutations (server actions). SERVER-SIDE only: the
 * httpOnly session cookie → Bearer never reaches the browser. Each re-verifies the session
 * and re-checks the §2 scope (defence in depth — the BFF re-enforces). Invoice-run creation
 * is four-eyes (202 + approval_request) — submitted to the approvals queue, never inline.
 * Mutating calls carry a fresh Idempotency-Key.
 */

async function principalOrBounce(required: string) {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value
  if (!token) redirect('/')
  let principal
  try {
    principal = await verifyAndMint(token)
  } catch {
    redirect('/')
  }
  if (!principal.superadmin && !principal.scopes.includes(required)) redirect('/tpp-billing')
  return token
}

export async function syncDirectoryAction(_prevState: TppWriteResult, formData: FormData): Promise<TppWriteResult> {
  const token = await principalOrBounce(SCOPES.operationsWrite)
  try {
    await syncDirectory(token, idempotencyKey(formData))
  } catch (e) {
    return tppFailure(e, 'Could not sync the directory. Please retry.', {})
  }
  redirect('/tpp-billing?status=synced')
}

export async function registerFinancialSystemAction(_prevState: TppWriteResult, formData: FormData): Promise<TppWriteResult> {
  const token = await principalOrBounce(SCOPES.billingWrite)
  const organisationId = String(formData.get('organisation_id') ?? '')
  try {
    await registerFinancialSystem(token, organisationId, idempotencyKey(formData))
  } catch (e) {
    return tppFailure(e, 'Could not register the financial system. Please retry.', { organisation_id: organisationId })
  }
  redirect('/tpp-billing?status=registered')
}

export async function createInvoiceRunAction(_prevState: TppWriteResult, formData: FormData): Promise<TppWriteResult> {
  const token = await principalOrBounce(SCOPES.billingWrite)
  const billingPeriod = String(formData.get('billing_period') ?? '')
  const recordSetId = String(formData.get('record_set_id') ?? '')
  let approvalId = ''
  try {
    const approval = await createInvoiceRun(token, { billing_period: billingPeriod, record_set_id: recordSetId }, idempotencyKey(formData))
    approvalId = approval.approval_request_id ?? ''
  } catch (e) {
    // Preserve the entered billing period + record set for the retry.
    return tppFailure(e, 'Could not submit the invoice run. Please retry.', { billing_period: billingPeriod, record_set_id: recordSetId })
  }
  // Surface the approval id so the initiator can track the four-eyes request (UX-03).
  redirect(`/tpp-billing?status=invoice_submitted${approvalId ? `&ar=${encodeURIComponent(approvalId)}` : ''}`)
}
