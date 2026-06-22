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

/** The capability tiles shown in the welcome hero ("what it does"). */
export const CAPABILITIES: { icon: string; title: string; detail: string }[] = [
  { icon: 'account_balance', title: 'Reconciliation', detail: 'Three-way Nebras · platform · fintech, with TPP-aaS margin' },
  { icon: 'support_agent', title: 'Customer Care', detail: 'PSU consent lifecycle — lookup, revoke, disputes' },
  { icon: 'gpp_maybe', title: 'Risk & Compliance', detail: 'Fraud response, audit trail, four-eyes control' },
  { icon: 'insights', title: 'Analytics', detail: 'Fee accrual, margin, SLOs & error budgets' }
]
