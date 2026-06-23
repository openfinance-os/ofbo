/**
 * BACKOFFICE-60 — agent personas. Each is a programmatic identity bound to a STRICT
 * SUBSET of an existing human persona's scopes (PRD §2 SCOPE_MATRIX), and read-only in
 * the ADR 0017 rollout step 1. The subset invariant is the load-bearing rule: an agent
 * may never hold a scope its human persona doesn't, and never `platform:superadmin`
 * (agents are service accounts — BACKOFFICE-80).
 *
 * The canonical human matrix lives in `@ofbo/bff/auth` (SCOPE_MATRIX). To keep the
 * gateway runtime decoupled from the BFF, this module does NOT import it at runtime —
 * the subset invariant is asserted by `assertSubsetOf(...)`, which the test suite runs
 * against the real SCOPE_MATRIX so drift fails CI.
 */

export interface AgentPersona {
  /** Stable id minted by the IdP (P2) / DCR (BACKOFFICE-60). */
  id: string
  /** The human persona this agent is a subset of (PRD §2). */
  derivedFrom: string
  /** Scopes — a STRICT SUBSET of `derivedFrom`'s scopes; never platform:superadmin. */
  scopes: readonly string[]
  /** ADR 0017: false until a human raises it AND spend-control (BACKOFFICE-53) is live. */
  allowMutations: boolean
  /** Per-session consequential-operation budget (BACKOFFICE-53). 0 ⇒ read-only. */
  spendBudget: number
}

/**
 * Seed catalogue of read-only agent personas. Each drops at least one scope from its
 * human persona (strict subset) and ships read-only (allowMutations:false, budget 0).
 */
export const AGENT_PERSONAS = {
  'care-readonly-agent': {
    id: 'care-readonly-agent',
    derivedFrom: 'customer-care-agent',
    scopes: ['consents:admin', 'audit:read'], // drops disputes:admin
    allowMutations: false,
    spendBudget: 0
  },
  'reconciliation-readonly-agent': {
    id: 'reconciliation-readonly-agent',
    derivedFrom: 'finance-analyst',
    scopes: ['reconciliation:read', 'billing:read'], // drops the *:write scopes
    allowMutations: false,
    spendBudget: 0
  },
  'compliance-readonly-agent': {
    id: 'compliance-readonly-agent',
    derivedFrom: 'compliance-officer',
    scopes: ['audit:read', 'compliance:reports:read'], // drops compliance:reports:generate
    allowMutations: false,
    spendBudget: 0
  },
  'analytics-readonly-agent': {
    id: 'analytics-readonly-agent',
    derivedFrom: 'programme-manager',
    scopes: ['platform:analytics:read'], // drops programme:read, certification:read
    allowMutations: false,
    spendBudget: 0
  }
} as const satisfies Record<string, AgentPersona>

export type AgentPersonaId = keyof typeof AGENT_PERSONAS

export class LeastPrivilegeViolation extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LeastPrivilegeViolation'
  }
}

/**
 * Assert an agent persona is a least-privilege subset of `humanMatrix[derivedFrom]`.
 * Throws LeastPrivilegeViolation on any breach. Run in tests against the real
 * SCOPE_MATRIX (and cheaply at session construction).
 */
export function assertSubsetOf(persona: AgentPersona, humanMatrix: Record<string, readonly string[]>): void {
  if (persona.derivedFrom === 'platform-super-admin') {
    throw new LeastPrivilegeViolation(`Agent persona ${persona.id} may not derive from platform-super-admin (BACKOFFICE-80).`)
  }
  const human = humanMatrix[persona.derivedFrom]
  if (!human) {
    throw new LeastPrivilegeViolation(`Agent persona ${persona.id} derives from unknown human persona ${persona.derivedFrom}.`)
  }
  for (const scope of persona.scopes) {
    if (scope === 'platform:superadmin') {
      throw new LeastPrivilegeViolation(`Agent persona ${persona.id} must never hold platform:superadmin.`)
    }
    if (!human.includes(scope)) {
      throw new LeastPrivilegeViolation(
        `Agent persona ${persona.id} holds scope \`${scope}\` not granted to its human persona ${persona.derivedFrom} — not least privilege.`
      )
    }
  }
  // Strict subset: an agent that simply mirrors a human persona is not least privilege.
  if (persona.scopes.length >= human.length) {
    throw new LeastPrivilegeViolation(
      `Agent persona ${persona.id} is not a STRICT subset of ${persona.derivedFrom} (holds ${persona.scopes.length} of ${human.length}).`
    )
  }
}
