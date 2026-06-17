'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { TOKEN_COOKIE } from '../../lib/cookies'
import { verifyAndMint } from '../../lib/portal'
import { claimBreak, resolveBreak, RESOLVE_OUTCOMES, type ResolveOutcome } from '../../lib/reconciliation'

/**
 * UI-03 — Reconciliation Console mutations (server actions). SERVER-SIDE only: the
 * httpOnly session cookie → Bearer never reaches the browser. Each re-verifies the
 * session through the IdP port and re-checks finance:reconciliation:write (defence in
 * depth — the BFF re-enforces). Mutating calls carry a fresh Idempotency-Key.
 */

const WRITE_SCOPE = 'finance:reconciliation:write'

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

export async function claimBreakAction(formData: FormData) {
  const token = await tokenOrBounce()
  const breakId = String(formData.get('break_id') ?? '')
  const runId = String(formData.get('run_id') ?? '')

  let status = 'claimed'
  try {
    await claimBreak(token, breakId, crypto.randomUUID())
  } catch {
    status = 'claim_failed'
  }
  redirect(reconHref(runId, status))
}

export async function resolveBreakAction(formData: FormData) {
  const token = await tokenOrBounce()
  const breakId = String(formData.get('break_id') ?? '')
  const runId = String(formData.get('run_id') ?? '')
  const rawOutcome = String(formData.get('resolution_outcome') ?? '')
  const note = String(formData.get('resolution_note') ?? '')

  // Never substitute a financial outcome the operator did not choose — surface the
  // failure if the value is outside the contract enum (the BFF would 400 anyway).
  if (!(RESOLVE_OUTCOMES as readonly string[]).includes(rawOutcome)) {
    redirect(reconHref(runId, 'resolve_failed'))
  }

  let status = 'resolved'
  try {
    await resolveBreak(token, breakId, { resolution_outcome: rawOutcome as ResolveOutcome, resolution_note: note }, crypto.randomUUID())
  } catch {
    status = 'resolve_failed'
  }
  redirect(reconHref(runId, status))
}
