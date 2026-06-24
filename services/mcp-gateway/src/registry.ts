import type { components } from '@ofbo/contracts'
import type { FetchLike, GatewaySession } from './gateway.js'

/**
 * BACKOFFICE-60 / ADR 0017 — drive the gateway from the agent registry. Instead of a
 * hardcoded persona, the gateway looks up a DCR-registered, four-eyes-APPROVED agent in
 * the BFF registry and adopts exactly its bound identity: scopes, allow_mutations, and
 * spend_budget. So a real registered agent (created + approved via the portal) drives the
 * gateway with precisely the authority it was granted — no more, no less.
 *
 * Reading the registry needs an admin token (platform:agents:read); the agent then calls
 * the BFF under its own operational token. In the demo the operational token is the demo
 * IdP token of the agent's human persona (derived_from); in production it is the DCR-issued
 * client credential (passed in explicitly).
 */

/** The subset of the OpenAPI AgentRegistration the gateway needs. */
export interface AgentRegistration {
  agent_id: string
  persona: string
  derived_from: string
  scopes: string[]
  status: 'pending' | 'active' | 'revoked'
  allow_mutations: boolean
  spend_budget: number
}

export class AgentRegistryLookupError extends Error {
  constructor(
    readonly code: 'not_found' | 'not_active' | 'lookup_failed',
    message: string
  ) {
    super(message)
    this.name = 'AgentRegistryLookupError'
  }
}

export interface FetchRegistrationOptions {
  baseUrl: string
  /** Admin bearer with platform:agents:read — used ONLY to read the registry. */
  adminToken: string
  agentId: string
  fetchImpl?: FetchLike
}

/** GET /back-office/agents/{agent_id} under the admin token. Throws on non-200 / missing. */
export async function fetchAgentRegistration(opts: FetchRegistrationOptions): Promise<AgentRegistration> {
  const f = opts.fetchImpl ?? ((url, init) => fetch(url, init))
  const url = opts.baseUrl.replace(/\/$/, '') + `/back-office/agents/${encodeURIComponent(opts.agentId)}`
  const res = await f(url, {
    method: 'GET',
    headers: { authorization: `Bearer ${opts.adminToken}`, 'x-fapi-interaction-id': crypto.randomUUID(), accept: 'application/json' }
  })
  const payload = (await res.json().catch(() => ({}))) as { data?: AgentRegistration; error?: { message?: string } }
  if (res.status === 404) throw new AgentRegistryLookupError('not_found', `No agent ${opts.agentId} in the registry.`)
  if (res.status >= 400 || !payload.data) {
    throw new AgentRegistryLookupError('lookup_failed', payload.error?.message ?? `Agent lookup failed (HTTP ${res.status}).`)
  }
  return payload.data
}

/** The fields the gateway needs from a minted agent session token (ADR 0018). */
export interface MintedAgentSession {
  session_token: string
  session_id: string
}

/**
 * ADR 0018 — POST /back-office/agents/{agent_id}:mint-session under the admin token. Returns
 * the short-lived, server-verifiable agent session token the gateway presents as its bearer,
 * so the BFF sees a real (agent_id, session_id) — not a borrowed human token — and can
 * re-assert spend-control. Throws on non-200 (e.g. a non-active agent → 409).
 */
export async function mintAgentSession(opts: FetchRegistrationOptions): Promise<MintedAgentSession> {
  const f = opts.fetchImpl ?? ((url, init) => fetch(url, init))
  const url = opts.baseUrl.replace(/\/$/, '') + `/back-office/agents/${encodeURIComponent(opts.agentId)}:mint-session`
  const res = await f(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${opts.adminToken}`,
      'x-fapi-interaction-id': crypto.randomUUID(),
      'idempotency-key': crypto.randomUUID(),
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: '{}'
  })
  const payload = (await res.json().catch(() => ({}))) as { data?: { session_token?: string; session_id?: string }; error?: { message?: string } }
  if (res.status >= 400 || !payload.data?.session_token || !payload.data.session_id) {
    throw new AgentRegistryLookupError('lookup_failed', payload.error?.message ?? `Agent session mint failed (HTTP ${res.status}).`)
  }
  return { session_token: payload.data.session_token, session_id: payload.data.session_id }
}

export interface SessionFromRegistrationOptions {
  sessionId: string
  /**
   * The agent's operational bearer for calling the BFF. With ADR 0018, pass the minted agent
   * SESSION token (from `mintAgentSession`) and its `session_id` as `sessionId`, so the BFF
   * verifies a real agent identity and re-asserts spend-control. The DCR client credential
   * (Option 1) slots in here at M6. Falls back to the demo human token (`demo-token:<derived_from>`)
   * only when no session is minted (legacy/test path).
   */
  agentToken?: string
}

/**
 * Build the gateway identity from a registration. Rejects a non-active agent (a revoked or
 * pending agent must never drive the gateway). Returns the session + the policy knobs the
 * registration carries, so the registration — not a hardcoded default — governs the gateway.
 */
export function sessionFromRegistration(
  reg: AgentRegistration,
  opts: SessionFromRegistrationOptions
): { session: GatewaySession; allowMutations: boolean; spendBudget: number } {
  if (reg.status !== 'active') {
    throw new AgentRegistryLookupError('not_active', `Agent ${reg.agent_id} is ${reg.status}, not active — it cannot drive the gateway.`)
  }
  return {
    session: {
      agentToken: opts.agentToken ?? `demo-token:${reg.derived_from}`,
      scopes: reg.scopes,
      sessionId: opts.sessionId,
      personaId: reg.persona
    },
    allowMutations: reg.allow_mutations,
    spendBudget: reg.spend_budget
  }
}

// Contract-drift guard — fails typecheck if the OpenAPI AgentRegistration renames or
// removes any field this module reads (the local interface is a hand-maintained subset).
type ConformsToContract<V> = keyof V extends keyof components['schemas']['AgentRegistration']
  ? true
  : ['CONTRACT DRIFT — registry.ts AgentRegistration has keys absent from the contract schema']
const _agentRegistrationConformsToContract: ConformsToContract<AgentRegistration> = true
void _agentRegistrationConformsToContract
