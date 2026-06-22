/**
 * UX — presentation-only guide for the welcome / persona-selector screen: a one-line
 * "what this role does" + the modules it can reach (per the §2 scope matrix) + an icon.
 * Cosmetic only — NOT contract data and NOT PII. The persona list itself (display_name,
 * demo_token) comes from the IdP port; this map just enriches each card by persona key.
 * Keep aligned with lib/nav.ts (the actual scope-gated module visibility).
 */
export interface PersonaGuide {
  tagline: string
  modules: string[]
  icon: string // Material Symbols name
}

export const PERSONA_GUIDE: Record<string, PersonaGuide> = {
  'operations-analyst': { tagline: 'Platform health, incidents & SLOs', modules: ['Operations', 'Dashboard'], icon: 'monitoring' },
  'customer-care-agent': { tagline: 'PSU consent lookups, revocations & disputes', modules: ['Customer Care'], icon: 'support_agent' },
  'compliance-officer': { tagline: 'Audit trail & regulatory oversight', modules: ['Compliance', 'Audit'], icon: 'verified_user' },
  'finance-analyst': { tagline: 'Reconciliation, TPP-aaS margin & monthly sign-off', modules: ['Reconciliation', 'Analytics'], icon: 'account_balance' },
  'risk-analyst': { tagline: 'Anomaly detection & fraud response', modules: ['Risk'], icon: 'gpp_maybe' },
  'commercial-desk-head': { tagline: 'TPP billing, registry & commercial margin', modules: ['TPP Billing', 'Analytics'], icon: 'paid' },
  'programme-manager': { tagline: 'Cross-programme executive view', modules: ['Dashboard', 'Analytics'], icon: 'insights' },
  'platform-super-admin': { tagline: 'Full platform access — every module', modules: ['All modules'], icon: 'admin_panel_settings' }
}

/** A friendly, human label for a persona key (e.g. "finance-analyst" → "Finance Analyst"). */
export function personaLabel(persona: string): string {
  return persona
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * Plain-language description of each §2 scope, for the profile screen ("what you're
 * allowed to do"). Keys are the raw scope strings (lib/scopes.ts); the raw string is
 * still shown subtly alongside for transparency. Presentation-only.
 */
export const SCOPE_DESCRIPTIONS: Record<string, string> = {
  'consents:admin': 'Look up PSU consents, revoke them, and run emergency bulk revocations',
  'consents:admin:fraud-revoke': 'Raise four-eyes fraud revocations',
  'disputes:admin': 'Open and manage unauthorised-payment disputes',
  'audit:read': 'Read the cross-operator audit log',
  'reconciliation:read': 'View reconciliation runs, breaks and the TPP-aaS margin',
  'finance:reconciliation:write': 'Claim & resolve breaks and request the monthly sign-off',
  'finance:disputes:write': 'Escalate reconciliation breaks to Nebras as disputes',
  'platform:analytics:read': 'View the executive analytics dashboard',
  'billing:read': 'View the TPP billing & registry',
  'billing:write': 'Manage TPP billing & registry entries',
  'platform:operations:read': 'View platform operations, SLOs and incidents',
  'platform:operations:write': 'Action platform operations & incidents',
  'compliance:reports:read': 'View compliance reports',
  'risk:read': 'View risk anomalies and signals',
  'platform:superadmin': 'Full platform access — every module and action'
}

/** The capability tiles shown in the welcome hero ("what it does"). */
export const CAPABILITIES: { icon: string; title: string; detail: string }[] = [
  { icon: 'account_balance', title: 'Reconciliation', detail: 'Three-way Nebras · platform · fintech, with TPP-aaS margin' },
  { icon: 'support_agent', title: 'Customer Care', detail: 'PSU consent lifecycle — lookup, revoke, disputes' },
  { icon: 'gpp_maybe', title: 'Risk & Compliance', detail: 'Fraud response, audit trail, four-eyes control' },
  { icon: 'insights', title: 'Analytics', detail: 'Fee accrual, margin, SLOs & error budgets' }
]
