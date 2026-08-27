import { NAV_MODULES, type NavKey } from './nav'

/**
 * UX — presentation-only guide for the welcome / persona-selector screen: a one-line
 * "what this role does" + the modules it can reach + an icon. Cosmetic only — NOT contract data
 * and NOT PII. The persona list itself (display_name, demo_token) comes from the IdP port; this
 * map just enriches each card by persona key.
 *
 * MODULES ARE NAV KEYS, NOT FREE TEXT. This file used to carry hand-written labels with a comment
 * asking whoever edited it to keep them aligned with `nav.ts`, and they drifted: Commercial Desk
 * Head advertised "Billing Control" and "TPP Billing" while the §2 matrix gives that persona no
 * `billing:read` at all — the sign-in screen promised a workspace the gate denied, on the first
 * screen anyone evaluating OFBO sees.
 *
 * Keying to `NAV_MODULES` makes that class of drift structurally impossible: the display name is
 * read from the nav module rather than retyped, an unknown key does not compile, and
 * persona-guide.spec asserts every advertised key is genuinely reachable for that persona's minted
 * scopes. A comment asking for alignment is not a mechanism.
 */
export interface PersonaGuide {
  tagline: string
  /** Nav module keys — the display name comes from NAV_MODULES, never retyped here. */
  modules: NavKey[]
  icon: string // Material Symbols name
}

/** Taglines and module sets follow the PRD §2 persona table, which is canon for both. */
export const PERSONA_GUIDE: Record<string, PersonaGuide> = {
  'operations-analyst': { tagline: 'Platform health, incidents & SLOs', modules: ['operations'], icon: 'monitoring' },
  'customer-care-agent': { tagline: 'PSU consent lookups, revocations & disputes', modules: ['customer-care', 'audit'], icon: 'support_agent' },
  'compliance-officer': { tagline: 'Audit trail & regulatory oversight', modules: ['compliance', 'audit'], icon: 'verified_user' },
  'finance-analyst': { tagline: 'Reconciliation, billing assurance & monthly sign-off', modules: ['finance', 'billing-console', 'billing', 'analytics'], icon: 'account_balance' },
  'risk-analyst': { tagline: 'Anomaly detection & fraud response', modules: ['risk'], icon: 'gpp_maybe' },
  // PRD §2: "Internal Portal — Executive Dashboard (Commercial angle)". Cross-fintech
  // revenue/margin, pipeline and onboarding funnel — read through Analytics, NOT the billing
  // consoles, which are the Finance Analyst's surface and need `billing:read` this persona does
  // not hold. The card said otherwise for months; the matrix was right and the card was wrong.
  'commercial-desk-head': { tagline: 'Cross-fintech revenue, margin & pipeline', modules: ['analytics'], icon: 'paid' },
  'programme-manager': { tagline: 'Adoption, certification & release-calendar alignment', modules: ['analytics'], icon: 'insights' },
  'platform-admin': { tagline: 'Agent registry & programmatic access administration', modules: ['agents'], icon: 'smart_toy' },
  'platform-super-admin': { tagline: 'Full platform access — every module', modules: NAV_MODULES.map((m) => m.key), icon: 'admin_panel_settings' }
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
  'billing:read': 'View the LFI billing control plane and TPP billing registry',
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
