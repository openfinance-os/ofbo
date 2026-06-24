/**
 * BACKOFFICE-60 — agent DCR registry data layer (ADR 0017). Calls the Hono BFF over the
 * OpenAPI contract paths, SERVER-SIDE only (Bearer from the httpOnly cookie, never in the
 * browser). fetch + base URL are injectable for unit tests. platform:agents:read gates the
 * screen; platform:agents:write gates register (four-eyes) + revoke (single-actor).
 * Behaviour/data = the contract; appearance = the Stitch design. No PSU PII — agents are
 * service-account metadata.
 */
import type { ApprovalRequest } from './approvals'
import { bffClient } from './bff'
import type { Schemas, KeysConformToContract, AssertContract } from './contract-types'

/** Mirrors the OpenAPI AgentRegistration wire shape. */
export interface AgentRegistration {
  agent_id: string
  client_id: string
  display_name: string
  persona: string
  derived_from: string
  scopes: string[]
  status: string
  allow_mutations: boolean
  spend_budget: number
  registered_by: string
  approved_by: string | null
  created_at: string
  revoked_at: string | null
  revoke_reason: string | null
}

/**
 * Selectable agent personas for the register form — mirrors the BFF AGENT_PERSONAS
 * catalogue (each a least-privilege, read-only subset of a human persona). The BFF binds
 * the actual scopes from the named persona and rejects anything unknown (400), so this is
 * just the picker; it never carries scopes.
 */
export const AGENT_PERSONAS: ReadonlyArray<{ id: string; label: string; derivedFrom: string }> = [
  { id: 'care-readonly-agent', label: 'Customer Care (read-only)', derivedFrom: 'customer-care-agent' },
  { id: 'reconciliation-readonly-agent', label: 'Reconciliation (read-only)', derivedFrom: 'finance-analyst' },
  { id: 'compliance-readonly-agent', label: 'Compliance (read-only)', derivedFrom: 'compliance-officer' },
  { id: 'analytics-readonly-agent', label: 'Analytics (read-only)', derivedFrom: 'programme-manager' }
]

export class AgentsApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly remediation?: string,
    readonly docsUrl?: string
  ) {
    super(message)
  }
}

/** Write-path result a register/revoke action returns to useActionState on failure (keeps the form). */
export type AgentWriteResult = {
  ok: boolean
  error?: string
  remediation?: string | null
  docsUrl?: string | null
  values?: Record<string, string>
}

export interface AgentsApiDeps {
  baseUrl?: string
  fetchImpl?: typeof fetch
  traceId?: string
}

function resolve(deps: AgentsApiDeps) {
  return { ...bffClient(deps), trace: deps.traceId ?? crypto.randomUUID() }
}

async function envelope<T>(res: Response): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const body = (await res.json().catch(() => ({}))) as {
    data?: T
    error?: { code?: string; message?: string; remediation?: string; docs_url?: string }
    meta?: Record<string, unknown>
  }
  if (!res.ok) {
    throw new AgentsApiError(body.error?.code ?? 'BACKOFFICE.ERROR', body.error?.message ?? `HTTP ${res.status}`, res.status, body.error?.remediation, body.error?.docs_url)
  }
  return { data: body.data as T, meta: body.meta }
}

const authHeaders = (token: string, trace: string) => ({ authorization: `Bearer ${token}`, 'x-fapi-interaction-id': trace })
const mutationHeaders = (token: string, trace: string, idempotencyKey: string) => ({ ...authHeaders(token, trace), 'idempotency-key': idempotencyKey })

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') sp.set(k, String(v))
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/** BACKOFFICE-60 — registered automation agents (platform:agents:read). */
export async function listAgents(token: string, query: { cursor?: string; limit?: number } = {}, deps: AgentsApiDeps = {}): Promise<{ agents: AgentRegistration[]; next_cursor: string | null }> {
  const { base, f, trace } = resolve(deps)
  const res = await f(`${base}/back-office/agents${qs({ cursor: query.cursor, limit: query.limit })}`, { headers: authHeaders(token, trace) })
  const { data, meta } = await envelope<AgentRegistration[]>(res)
  return { agents: data ?? [], next_cursor: (meta?.next_cursor as string | null) ?? null }
}

/**
 * BACKOFFICE-60 — register an automation agent under a pre-defined persona (platform:agents:write).
 * Four-eyes: returns 202 + approval_request (the credential is issued only on a different
 * principal's approval — never inline). The caller names the persona; the BFF binds its scopes.
 */
export async function registerAgent(token: string, body: { persona: string; display_name: string }, idempotencyKey: string, deps: AgentsApiDeps = {}): Promise<ApprovalRequest> {
  const { base, f, trace } = resolve(deps)
  const res = await f(`${base}/back-office/agents:register`, {
    method: 'POST',
    headers: { ...mutationHeaders(token, trace, idempotencyKey), 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return (await envelope<ApprovalRequest>(res)).data
}

/** BACKOFFICE-60 — revoke (deactivate) an agent (platform:agents:write). Single-actor kill switch, audited. */
export async function revokeAgent(token: string, agentId: string, reason: string, idempotencyKey: string, deps: AgentsApiDeps = {}): Promise<AgentRegistration> {
  const { base, f, trace } = resolve(deps)
  const res = await f(`${base}/back-office/agents/${encodeURIComponent(agentId)}:revoke`, {
    method: 'POST',
    headers: { ...mutationHeaders(token, trace, idempotencyKey), 'content-type': 'application/json' },
    body: JSON.stringify({ reason })
  })
  return (await envelope<AgentRegistration>(res)).data
}

// ADR-0004 drift guard — fail typecheck if the contract renames/removes a field this view reads.
export type AgentRegistrationContractGuard = AssertContract<KeysConformToContract<AgentRegistration, Schemas['AgentRegistration']>>
