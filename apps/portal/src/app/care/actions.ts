'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { TOKEN_COOKIE } from '../../lib/cookies'
import { SCOPES } from '../../lib/scopes'
import { verifyAndMint } from '../../lib/portal'
import { createDispute, revokeConsent, DISPUTE_TYPES, type DisputeType, type RevokeReasonCode } from '../../lib/care'
import { idempotencyKey } from '../../lib/idempotency'

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

export async function revokeConsentAction(formData: FormData) {
  const { token } = await principalOrBounce(SCOPES.consentsAdmin)
  const consentId = String(formData.get('consent_id') ?? '')
  const reasonCode = String(formData.get('reason_code') ?? '') as RevokeReasonCode
  const identifierType = String(formData.get('identifier_type') ?? 'bank_customer_id')
  const identifier = String(formData.get('identifier') ?? '')

  let status = 'revoked'
  try {
    await revokeConsent(token, consentId, reasonCode, idempotencyKey(formData))
  } catch {
    status = 'revoke_failed'
  }
  redirect(careHref(identifierType, identifier, status))
}

export async function createDisputeAction(formData: FormData) {
  const { token } = await principalOrBounce(SCOPES.disputesAdmin)
  const identifierType = String(formData.get('identifier_type') ?? 'bank_customer_id')
  const identifier = String(formData.get('identifier') ?? '')
  const rawType = String(formData.get('dispute_type') ?? '')
  const disputeType: DisputeType = (DISPUTE_TYPES as readonly string[]).includes(rawType) ? (rawType as DisputeType) : 'unauthorised_payment'
  const paymentId = String(formData.get('originating_payment_id') ?? '')

  let status = 'dispute_opened'
  try {
    await createDispute(
      token,
      { psu_identifier: identifier, dispute_type: disputeType, ...(paymentId ? { originating_payment_id: paymentId } : {}) },
      idempotencyKey(formData)
    )
  } catch {
    status = 'dispute_failed'
  }
  redirect(careHref(identifierType, identifier, status))
}
