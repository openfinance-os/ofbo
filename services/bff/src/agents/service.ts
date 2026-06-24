import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import type { HighClassAuditSink } from '../high-class-audit.js'
import type { ApprovalRecord, GatedOperation } from '../approvals/service.js'
import { ApprovalsService } from '../approvals/service.js'
import { AGENT_PERSONAS, type AgentPersonaDef } from './personas.js'

/**
 * BACKOFFICE-60 — agent DCR registry (ADR 0017). Programmatic admin-scope access for
 * automations. Registration is FOUR-EYES (202 + approval_request; the credential is
 * issued only on a different principal's approval). Revocation is single-actor — granting
 * authority needs two principals, removing it needs one (fast kill switch). The caller
 * names a persona; the server binds that persona's least-privilege scopes (no arbitrary-
 * scope DCR escalation). One High-class audit per register/revoke. No PII — agents are
 * service accounts.
 */
export const AGENT_READ_SCOPE = 'platform:agents:read'
export const AGENT_WRITE_SCOPE = 'platform:agents:write'
export const AGENT_REGISTER_OPERATION = 'agents.register'

export type AgentStatus = 'pending' | 'active' | 'revoked'

export interface StoredAgent {
  agent_id: string
  client_id: string
  display_name: string
  persona: string
  derived_from: string
  scopes: string[]
  status: AgentStatus
  allow_mutations: boolean
  spend_budget: number
  registered_by: string
  approved_by: string | null
  created_at: string
  revoked_at: string | null
  revoke_reason: string | null
}

export interface AgentListQuery {
  cursor?: string
  limit?: number
}
export interface AgentPage {
  rows: StoredAgent[]
  next_cursor: string | null
}

export class AgentRegistryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface AgentStore {
  create(agent: StoredAgent, traceId: string): Promise<StoredAgent>
  get(agentId: string): Promise<StoredAgent | null>
  list(query: AgentListQuery): Promise<AgentPage>
  update(agentId: string, patch: Partial<StoredAgent>, traceId: string): Promise<StoredAgent | null>
}

const encodeAgentCursor = (createdAt: string, id: string) => Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url')
function decodeAgentCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
    return createdAt && id ? { createdAt, id } : null
  } catch {
    return null
  }
}

/** No-database default (tests / demo profile). The worker wires a durable Pg store. */
export class InMemoryAgentStore implements AgentStore {
  private readonly rows: StoredAgent[] = []
  async create(agent: StoredAgent, _traceId?: string): Promise<StoredAgent> {
    this.rows.push(agent)
    return agent
  }
  async get(agentId: string): Promise<StoredAgent | null> {
    return this.rows.find((r) => r.agent_id === agentId) ?? null
  }
  /**
   * Cursor pagination matching PgAgentStore (port parity, CLAUDE.md M6): stable sort by
   * (created_at, agent_id), slice `limit`, emit a base64url cursor. So the demo profile and
   * the unit tests exercise real cursor behaviour, not an everything-in-one-page stub.
   */
  async list(query: AgentListQuery = {}): Promise<AgentPage> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
    const sorted = [...this.rows].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.agent_id.localeCompare(b.agent_id))
    const after = query.cursor ? decodeAgentCursor(query.cursor) : null
    const start = after
      ? sorted.findIndex((r) => r.created_at > after.createdAt || (r.created_at === after.createdAt && r.agent_id > after.id))
      : 0
    const slice = start < 0 ? [] : sorted.slice(start, start + limit)
    const hasMore = start >= 0 && sorted.length > start + limit
    const last = slice[slice.length - 1]
    return { rows: slice, next_cursor: hasMore && last ? encodeAgentCursor(last.created_at, last.agent_id) : null }
  }
  async update(agentId: string, patch: Partial<StoredAgent>, _traceId?: string): Promise<StoredAgent | null> {
    const r = this.rows.find((x) => x.agent_id === agentId)
    if (!r) return null
    Object.assign(r, patch)
    return r
  }
}

/**
 * The four-eyes-gated registration operation. Runs ONLY on the second principal's
 * approval: issues the client credential, persists the agent active, and emits the
 * High-class audit (agent_registered) carrying the approver. The scopes were bound from
 * the persona at INITIATION and travel in the payload — the approver cannot widen them.
 */
export function makeAgentRegisterOperation(deps: { store: AgentStore; audit: HighClassAuditSink }): GatedOperation {
  return {
    initiatorScope: AGENT_WRITE_SCOPE,
    approverScope: AGENT_WRITE_SCOPE,
    execute: async (payload, ctx) => {
      const now = new Date().toISOString()
      const agent: StoredAgent = {
        agent_id: crypto.randomUUID(),
        client_id: `agent-${crypto.randomUUID()}`,
        display_name: String(payload.display_name),
        persona: String(payload.persona),
        derived_from: String(payload.derived_from),
        scopes: (payload.scopes as string[]) ?? [],
        status: 'active',
        allow_mutations: Boolean(payload.allow_mutations),
        spend_budget: Number(payload.spend_budget ?? 0),
        registered_by: String(payload.initiated_by ?? 'unknown'),
        approved_by: ctx?.approver ?? null,
        created_at: now,
        revoked_at: null,
        revoke_reason: null
      }
      await deps.store.create(agent, String(payload.trace_id ?? 'unknown'))
      await deps.audit.emit({
        event_type: 'agent_registered',
        acting_principal: ctx?.approver ?? String(payload.initiated_by ?? 'unknown'),
        acting_persona: ctx?.approverPersona ?? 'platform-admin',
        scope_used: AGENT_WRITE_SCOPE,
        request_trace_id: String(payload.trace_id ?? 'unknown'),
        request_body: {
          agent_id: agent.agent_id,
          client_id: agent.client_id,
          persona: agent.persona,
          derived_from: agent.derived_from,
          scopes: agent.scopes,
          allow_mutations: agent.allow_mutations,
          spend_budget: agent.spend_budget,
          registered_by: agent.registered_by
        },
        response_status: 200
      })
      return toWire(agent)
    }
  }
}

export function toWire(a: StoredAgent) {
  return {
    agent_id: a.agent_id,
    client_id: a.client_id,
    display_name: a.display_name,
    persona: a.persona,
    derived_from: a.derived_from,
    scopes: a.scopes,
    status: a.status,
    allow_mutations: a.allow_mutations,
    spend_budget: a.spend_budget,
    registered_by: a.registered_by,
    approved_by: a.approved_by,
    created_at: a.created_at,
    revoked_at: a.revoked_at,
    revoke_reason: a.revoke_reason
  }
}

export class AgentRegistryService {
  constructor(
    private readonly approvals: ApprovalsService,
    private readonly store: AgentStore,
    private readonly audit: HighClassAuditSink
  ) {}

  /** Register an agent under a pre-defined persona — four-eyes (returns the approval_request). */
  async register(principal: Principal, input: { persona?: string; display_name?: string }, traceId: string): Promise<ApprovalRecord> {
    assertScope(principal, AGENT_WRITE_SCOPE)
    const personaId = input.persona
    if (!personaId || !(personaId in AGENT_PERSONAS)) {
      throw new AgentRegistryError(
        'BACKOFFICE.UNKNOWN_AGENT_PERSONA',
        `persona must be one of: ${Object.keys(AGENT_PERSONAS).join(', ')}.`,
        400
      )
    }
    if (!input.display_name || input.display_name.trim().length < 3) {
      throw new AgentRegistryError('BACKOFFICE.INVALID_BODY', 'display_name (min 3 chars) is required.', 400)
    }
    const persona: AgentPersonaDef = AGENT_PERSONAS[personaId as keyof typeof AGENT_PERSONAS]
    // Scopes are BOUND HERE from the persona — never taken from the caller.
    return this.approvals.requestApproval(
      principal,
      {
        operation_type: AGENT_REGISTER_OPERATION,
        operation_payload: {
          persona: persona.id,
          display_name: input.display_name.trim(),
          derived_from: persona.derivedFrom,
          scopes: [...persona.scopes],
          allow_mutations: persona.allowMutations,
          spend_budget: persona.spendBudget,
          initiated_by: principal.subject,
          initiated_by_persona: principal.persona,
          trace_id: traceId
        }
      },
      traceId
    )
  }

  async list(principal: Principal, query: AgentListQuery): Promise<AgentPage> {
    assertScope(principal, AGENT_READ_SCOPE)
    return this.store.list(query)
  }

  async get(principal: Principal, agentId: string): Promise<StoredAgent> {
    assertScope(principal, AGENT_READ_SCOPE)
    const agent = await this.store.get(agentId)
    if (!agent) throw new AgentRegistryError('BACKOFFICE.AGENT_NOT_FOUND', 'No agent matches that id.', 404)
    return agent
  }

  /** Revoke (deactivate) an agent — single-actor kill switch (deliberately NOT four-eyes). */
  async revoke(principal: Principal, agentId: string, input: { reason?: string }, traceId: string): Promise<StoredAgent> {
    assertScope(principal, AGENT_WRITE_SCOPE)
    if (!input.reason || input.reason.trim().length < 10) {
      throw new AgentRegistryError('BACKOFFICE.INVALID_BODY', 'reason (min 10 chars) is required.', 400)
    }
    const agent = await this.store.get(agentId)
    if (!agent) throw new AgentRegistryError('BACKOFFICE.AGENT_NOT_FOUND', 'No agent matches that id.', 404)
    if (agent.status === 'revoked') {
      throw new AgentRegistryError('BACKOFFICE.AGENT_ALREADY_REVOKED', 'That agent is already revoked.', 409)
    }
    const updated = await this.store.update(
      agentId,
      {
        status: 'revoked',
        revoked_at: new Date().toISOString(),
        revoke_reason: input.reason.trim()
      },
      traceId
    )
    if (!updated) throw new AgentRegistryError('BACKOFFICE.AGENT_NOT_FOUND', 'No agent matches that id.', 404)

    await this.audit.emit({
      event_type: 'agent_revoked',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: AGENT_WRITE_SCOPE,
      request_trace_id: traceId,
      request_body: { agent_id: agentId, reason: input.reason.trim(), persona: agent.persona },
      response_status: 200,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })
    return updated
  }
}
