/**
 * UI-gated persona scopes (PRD §2 scope matrix) — the single source of truth the
 * portal checks against. Scope hygiene is load-bearing (CLAUDE.md hard stop): holding
 * every gate in one auditable list means a matrix change is one edit (not a hunt across
 * pages, actions, and nav), and the full set of scopes the UI gates on is reviewable at
 * a glance. Values are the literal scope strings the IdP port mints and the BFF enforces
 * — they MUST stay identical to the BFF scope names.
 */
export const SCOPES = {
  consentsAdmin: 'consents:admin',
  disputesAdmin: 'disputes:admin',
  auditRead: 'audit:read',
  reconciliationRead: 'reconciliation:read',
  reconciliationWrite: 'finance:reconciliation:write',
  disputesWrite: 'finance:disputes:write',
  analyticsRead: 'platform:analytics:read',
  billingRead: 'billing:read',
  billingWrite: 'billing:write',
  operationsRead: 'platform:operations:read',
  operationsWrite: 'platform:operations:write',
  complianceRead: 'compliance:reports:read',
  riskRead: 'risk:read'
} as const

export type Scope = (typeof SCOPES)[keyof typeof SCOPES]
