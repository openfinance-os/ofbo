'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { TOKEN_COOKIE } from '../../lib/cookies'
import { SCOPES } from '../../lib/scopes'
import { verifyAndMint } from '../../lib/portal'
import { claimBreak, resolveBreak, requestMonthlySignoff, ReconApiError, RESOLVE_OUTCOMES, type ResolveOutcome, type ReconWriteResult } from '../../lib/reconciliation'
import { idempotencyKey } from '../../lib/idempotency'

/**
 * UX-06c — on failure a recon write action RETURNS a ReconWriteResult (no redirect) so the
 * form re-renders in place with the typed BFF error (message + remediation + docs_url) AND
 * keeps the operator's inputs (resolution outcome + note). Success still redirect()s.
 */
function reconFailure(e: unknown, fallback: string, values: Record<string, string>): ReconWriteResult {
  if (e instanceof ReconApiError) {
    return { ok: false, error: e.message, remediation: e.remediation ?? null, docsUrl: e.docsUrl ?? null, values }
  }
  return { ok: false, error: fallback, values }
}

/**
 * UI-03 — Reconciliation Console mutations (server actions). SERVER-SIDE only: the
 * httpOnly session cookie → Bearer never reaches the browser. Each re-verifies the
 * session through the IdP port and re-checks finance:reconciliation:write (defence in
 * depth — the BFF re-enforces). Mutating calls carry a fresh Idempotency-Key.
 */

const WRITE_SCOPE = SCOPES.reconciliationWrite

async function tokenOrBounce() {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value
  if (!token) redirect('/')
  let principal
  try {
    principal = await verifyAndMint(token)
  } catch {
    redirect('/')
  }
  if (!principal.superadmin && !principal.scopes.includes(WRITE_SCOPE)) redirect('/reconciliation')
  return token
}

function reconHref(runId: string, status: string) {
  const q = new URLSearchParams({ status })
  if (runId) q.set('run_id', runId)
  return `/reconciliation?${q.toString()}`
}

export async function claimBreakAction(_prevState: ReconWriteResult, formData: FormData): Promise<ReconWriteResult> {
  const token = await tokenOrBounce()
  const breakId = String(formData.get('break_id') ?? '')
  const runId = String(formData.get('run_id') ?? '')

  try {
    await claimBreak(token, breakId, idempotencyKey(formData))
  } catch (e) {
    return reconFailure(e, 'Could not claim the break. Please retry.', {})
  }
  redirect(reconHref(runId, 'claimed'))
}

/**
 * BACKOFFICE-06 — REQUEST the four-eyes monthly sign-off. The BFF returns 202 + an
 * approval_request; a different finance principal approves it in /approvals (never inline).
 * On success we redirect with a notice; the typed BFF error re-renders the form in place.
 */
export async function requestSignoffAction(_prevState: ReconWriteResult, formData: FormData): Promise<ReconWriteResult> {
  const token = await tokenOrBounce()
  const period = String(formData.get('period') ?? '')
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    return { ok: false, error: 'Enter a calendar month as YYYY-MM (e.g. 2026-06).', values: { period } }
  }
  try {
    await requestMonthlySignoff(token, period, idempotencyKey(formData))
  } catch (e) {
    return reconFailure(e, 'Could not request the monthly sign-off. Please retry.', { period })
  }
  redirect(reconHref('', 'signoff_requested'))
}

export async function resolveBreakAction(_prevState: ReconWriteResult, formData: FormData): Promise<ReconWriteResult> {
  const token = await tokenOrBounce()
  const breakId = String(formData.get('break_id') ?? '')
  const runId = String(formData.get('run_id') ?? '')
  const rawOutcome = String(formData.get('resolution_outcome') ?? '')
  const note = String(formData.get('resolution_note') ?? '')
  const values = { resolution_outcome: rawOutcome, resolution_note: note }

  // Never substitute a financial outcome the operator did not choose — surface the failure
  // (keeping their inputs) if the value is outside the contract enum (the BFF would 400 anyway).
  if (!(RESOLVE_OUTCOMES as readonly string[]).includes(rawOutcome)) {
    return { ok: false, error: 'Choose a resolution outcome before resolving.', values }
  }

  try {
    await resolveBreak(token, breakId, { resolution_outcome: rawOutcome as ResolveOutcome, resolution_note: note }, idempotencyKey(formData))
  } catch (e) {
    return reconFailure(e, 'Could not resolve the break. Please retry.', values)
  }
  redirect(reconHref(runId, 'resolved'))
}
