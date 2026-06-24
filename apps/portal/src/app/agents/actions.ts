'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { TOKEN_COOKIE } from '../../lib/cookies'
import { SCOPES } from '../../lib/scopes'
import { verifyAndMint } from '../../lib/portal'
import { registerAgent, revokeAgent, AgentsApiError } from '../../lib/agents'
import { idempotencyKey } from '../../lib/idempotency'

/**
 * BACKOFFICE-60 — Agent Registry mutations (server actions). SERVER-SIDE only: the httpOnly
 * session cookie → Bearer never reaches the browser. Each re-verifies the session and
 * re-checks platform:agents:write (defence in depth — the BFF re-enforces). Registration is
 * four-eyes (202 + approval_request) — submitted to the approvals queue, never inline; the
 * initiator gets the approval id deep-link. Revoke is single-actor. Mutating calls carry a
 * fresh Idempotency-Key.
 */
async function tokenOrBounce(): Promise<string> {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value
  if (!token) redirect('/')
  let principal
  try {
    principal = await verifyAndMint(token)
  } catch {
    redirect('/')
  }
  if (!principal.superadmin && !principal.scopes.includes(SCOPES.agentsWrite)) redirect('/agents')
  return token
}

export async function registerAgentAction(formData: FormData): Promise<void> {
  const token = await tokenOrBounce()
  const persona = String(formData.get('persona') ?? '')
  const displayName = String(formData.get('display_name') ?? '')
  let approvalId = ''
  try {
    const approval = await registerAgent(token, { persona, display_name: displayName }, idempotencyKey(formData))
    approvalId = approval.approval_request_id ?? ''
  } catch (e) {
    const code = e instanceof AgentsApiError ? `&code=${encodeURIComponent(e.code)}` : ''
    redirect(`/agents?status=register_failed${code}`)
  }
  redirect(`/agents?status=registered${approvalId ? `&ar=${encodeURIComponent(approvalId)}` : ''}`)
}

export async function revokeAgentAction(formData: FormData): Promise<void> {
  const token = await tokenOrBounce()
  const agentId = String(formData.get('agent_id') ?? '')
  const reason = String(formData.get('reason') ?? '')
  try {
    await revokeAgent(token, agentId, reason, idempotencyKey(formData))
  } catch {
    redirect('/agents?status=revoke_failed')
  }
  redirect('/agents?status=revoked')
}
