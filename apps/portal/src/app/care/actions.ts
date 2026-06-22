'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { TOKEN_COOKIE } from '../../lib/cookies'
import { SCOPES } from '../../lib/scopes'
import { verifyAndMint } from '../../lib/portal'
import { createDispute, revokeConsent, bulkRevoke, CareApiError, DISPUTE_TYPES, type DisputeType, type RevokeReasonCode, type CareWriteResult } from '../../lib/care'
import { idempotencyKey } from '../../lib/idempotency'

/**
 * UX-06b — on failure a care write action RETURNS a CareWriteResult (no redirect) so the form
 * re-renders in place with the real typed BFF error (message + remediation + docs_url, UX-06)
 * AND keeps the operator's entered values. Success still redirect()s so the notice shows.
 * `values` stays client-side (the user typed it) — never put in the URL, so no PSU free-text
 * leaks into the address bar / logs.
 */
function careFailure(e: unknown, fallback: string, values: Record<string, string>): CareWriteResult {
  if (e instanceof CareApiError) {
    return { ok: false, error: e.message, remediation: e.remediation ?? null, docsUrl: e.docsUrl ?? null, values }
  }
  return { ok: false, error: fallback, values }
}

/**
 * UI-02 — Customer Care Console mutations (server actions). They run SERVER-SIDE
 * only: the httpOnly session cookie → Bearer token never reaches the browser. Each
 * re-verifies the session through the IdP port and re-checks the §2 scope (defence
 * in depth — the BFF enforces it too). Mutating calls carry a fresh Idempotency-Key.
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
  if (!principal.superadmin && !principal.scopes.includes(required)) redirect('/care')
  return { token, principal }
}

/** A backlink that preserves the active PSU search so the page re-renders in place. */
function careHref(identifierType: string, identifier: string, status: string) {
  const q = new URLSearchParams({ identifier_type: identifierType, identifier, status })
  return `/care?${q.toString()}`
}

export async function revokeConsentAction(_prevState: CareWriteResult, formData: FormData): Promise<CareWriteResult> {
  const { token } = await principalOrBounce(SCOPES.consentsAdmin)
  const consentId = String(formData.get('consent_id') ?? '')
  const reasonCode = String(formData.get('reason_code') ?? '') as RevokeReasonCode
  const identifierType = String(formData.get('identifier_type') ?? 'bank_customer_id')
  const identifier = String(formData.get('identifier') ?? '')

  try {
    await revokeConsent(token, consentId, reasonCode, idempotencyKey(formData))
  } catch (e) {
    // Preserve the chosen reason so the operator doesn't re-pick it on retry.
    return careFailure(e, 'Could not revoke the consent. Please retry.', { reason_code: reasonCode })
  }
  redirect(careHref(identifierType, identifier, 'revoked'))
}

/**
 * BACKOFFICE-18 — request the emergency PSU-wide bulk revocation (four-eyes). The BFF
 * returns 202 + an approval_request; a different consents-admin approver completes it in
 * /approvals. Re-checks consents:admin (BFF re-enforces). Success redirects with a notice.
 */
export async function bulkRevokeAction(_prevState: CareWriteResult, formData: FormData): Promise<CareWriteResult> {
  const { token } = await principalOrBounce(SCOPES.consentsAdmin)
  const identifierType = String(formData.get('identifier_type') ?? 'bank_customer_id')
  const identifier = String(formData.get('identifier') ?? '')
  if (!identifier.trim()) return { ok: false, error: 'No PSU in context to bulk-revoke. Search a PSU first.' }
  try {
    await bulkRevoke(token, identifierType, identifier, idempotencyKey(formData))
  } catch (e) {
    return careFailure(e, 'Could not request the bulk revocation. Please retry.', {})
  }
  redirect(careHref(identifierType, identifier, 'bulk_revoke_requested'))
}

export async function createDisputeAction(_prevState: CareWriteResult, formData: FormData): Promise<CareWriteResult> {
  const { token } = await principalOrBounce(SCOPES.disputesAdmin)
  const identifierType = String(formData.get('identifier_type') ?? 'bank_customer_id')
  const identifier = String(formData.get('identifier') ?? '')
  const rawType = String(formData.get('dispute_type') ?? '')
  const disputeType: DisputeType = (DISPUTE_TYPES as readonly string[]).includes(rawType) ? (rawType as DisputeType) : 'unauthorised_payment'
  const paymentId = String(formData.get('originating_payment_id') ?? '')

  try {
    await createDispute(
      token,
      { psu_identifier: identifier, dispute_type: disputeType, ...(paymentId ? { originating_payment_id: paymentId } : {}) },
      idempotencyKey(formData)
    )
  } catch (e) {
    // Preserve the entered payment id + chosen dispute type for the retry.
    return careFailure(e, 'Could not open the dispute. Please retry.', { originating_payment_id: paymentId, dispute_type: disputeType })
  }
  redirect(careHref(identifierType, identifier, 'dispute_opened'))
}
