import { SCOPE_MATRIX } from '../auth.js'

/**
 * BACKOFFICE-60 — authoritative agent persona catalogue (ADR 0017). The BFF is the
 * authority that BINDS scopes at registration: a DCR caller names one of these personas
 * and the server attaches that persona's scopes — the caller can never request scopes
 * directly, so DCR is not a scope-escalation path.
 *
 * Each persona is a STRICT SUBSET of a human persona (PRD §2 SCOPE_MATRIX) and never
 * holds platform:superadmin (BACKOFFICE-80 — agents are service accounts). All ship
 * read-only (allow_mutations:false, spend_budget:0) until a human raises both AND
 * spend-control (BACKOFFICE-53) is live. The @ofbo/mcp-gateway catalogue mirrors this;
 * the BFF binding is the security-bearing one (the gateway only shapes what the agent sees).
 */
export interface AgentPersonaDef {
  id: string
  derivedFrom: string
  scopes: readonly string[]
  allowMutations: boolean
  spendBudget: number
}

export const AGENT_PERSONAS = {
  'care-readonly-agent': {
    id: 'care-readonly-agent',
    derivedFrom: 'customer-care-agent',
    scopes: ['consents:admin', 'audit:read'],
    allowMutations: false,
    spendBudget: 0
  },
  'reconciliation-readonly-agent': {
    id: 'reconciliation-readonly-agent',
    derivedFrom: 'finance-analyst',
    scopes: ['reconciliation:read', 'billing:read'],
    allowMutations: false,
    spendBudget: 0
  },
  'compliance-readonly-agent': {
    id: 'compliance-readonly-agent',
    derivedFrom: 'compliance-officer',
    scopes: ['audit:read', 'compliance:reports:read'],
    allowMutations: false,
    spendBudget: 0
  },
  'analytics-readonly-agent': {
    id: 'analytics-readonly-agent',
    derivedFrom: 'programme-manager',
    scopes: ['platform:analytics:read'],
    allowMutations: false,
    spendBudget: 0
  }
} as const satisfies Record<string, AgentPersonaDef>

export type AgentPersonaId = keyof typeof AGENT_PERSONAS

/** True when `persona` is a strict, least-privilege subset of its human persona and holds no superadmin. */
export function isLeastPrivilege(persona: AgentPersonaDef): boolean {
  if (persona.derivedFrom === 'platform-super-admin') return false
  const human = (SCOPE_MATRIX as Record<string, readonly string[]>)[persona.derivedFrom]
  if (!human) return false
  if (persona.scopes.some((s) => s === 'platform:superadmin')) return false
  if (!persona.scopes.every((s) => human.includes(s))) return false
  // strict subset — an agent that mirrors its human persona is not least privilege
  return persona.scopes.length < human.length
}
