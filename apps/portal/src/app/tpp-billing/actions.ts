'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { TOKEN_COOKIE } from '../../lib/cookies'
import { SCOPES } from '../../lib/scopes'
import { verifyAndMint } from '../../lib/portal'
import { createInvoiceRun, registerFinancialSystem, syncDirectory } from '../../lib/tpp-billing'

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

export async function syncDirectoryAction() {
  const token = await principalOrBounce(SCOPES.operationsWrite)
  let status = 'synced'
  try {
    await syncDirectory(token, crypto.randomUUID())
  } catch {
    status = 'sync_failed'
  }
  redirect(`/tpp-billing?status=${status}`)
}

export async function registerFinancialSystemAction(formData: FormData) {
  const token = await principalOrBounce(SCOPES.billingWrite)
  const organisationId = String(formData.get('organisation_id') ?? '')
  let status = 'registered'
  try {
    await registerFinancialSystem(token, organisationId, crypto.randomUUID())
  } catch {
    status = 'register_failed'
  }
  redirect(`/tpp-billing?status=${status}`)
}

export async function createInvoiceRunAction(formData: FormData) {
  const token = await principalOrBounce(SCOPES.billingWrite)
  const billingPeriod = String(formData.get('billing_period') ?? '')
  const recordSetId = String(formData.get('record_set_id') ?? '')
  let status = 'invoice_submitted'
  try {
    await createInvoiceRun(token, { billing_period: billingPeriod, record_set_id: recordSetId }, crypto.randomUUID())
  } catch {
    status = 'invoice_failed'
  }
  redirect(`/tpp-billing?status=${status}`)
}
