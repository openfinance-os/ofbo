import type {
  ApmPort,
  CareSurfacePort,
  CoreBankingPort,
  FinancialSystemPort,
  IdentityProviderPort,
  ItsmPort,
  LineagePort,
  NebrasEgressPort,
  OnboardingHandoverPort,
  PortMap
} from '../interfaces.js'

/**
 * Demo-profile simulator adapters (PRD §3.1). Deterministic by construction —
 * counters and fixed datasets, no randomness — so demo walkthroughs repeat.
 * The Nebras simulator service (services/nebras-sim, M1) will back P6; at M0
 * the sim adapter holds the deterministic in-memory behavior.
 */

let seq = 0
const nextId = (prefix: string) => `${prefix}-${String(++seq).padStart(6, '0')}`

const PERSONAS = [
  ['operations-analyst', 'OF Operations Analyst'],
  ['customer-care-agent', 'Customer Care Agent (OF)'],
  ['compliance-officer', 'OF Compliance Officer'],
  ['finance-analyst', 'OF Finance Analyst'],
  ['risk-analyst', 'OF Risk Analyst'],
  ['commercial-desk-head', 'Commercial Desk Head'],
  ['programme-manager', 'OF Programme Manager'],
  ['platform-super-admin', 'Platform Super Administrator']
] as const

const simCareSurface: CareSurfacePort = {
  async mintCareToken({ agent_id, psu_id }) {
    return {
      token: nextId('care-token'),
      act: agent_id,
      sub: psu_id,
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString()
    }
  }
}

const simIdentityProvider: IdentityProviderPort = {
  async personaLogins() {
    return PERSONAS.map(([persona, display_name]) => ({
      persona,
      display_name,
      demo_token: `demo-token:${persona}`
    }))
  },
  async verifyToken(token) {
    const persona = token.replace(/^demo-token:/, '')
    if (!PERSONAS.some(([p]) => p === persona)) throw new Error('unknown demo token')
    return { subject: `demo:${persona}`, persona, mfa: true }
  }
}

const simItsm: ItsmPort = {
  async createTicket() {
    return { ticket_id: nextId('itsm') }
  }
}

const simCoreBanking: CoreBankingPort = {
  async getBalance() {
    return { balance: { amount: 1_500_000, currency: 'AED' }, as_of: new Date().toISOString() }
  },
  async getTransactions() {
    return [
      { ref: 'tx-000001', amount: { amount: -25_000, currency: 'AED' }, booked_at: '2026-06-01T08:00:00Z' },
      { ref: 'tx-000002', amount: { amount: 150_000, currency: 'AED' }, booked_at: '2026-06-02T09:30:00Z' }
    ]
  }
}

const simApm: ApmPort = {
  async exportSpans() {
    /* console/file sink lands with the OTel wiring (M1); accepting the batch is the contract */
  }
}

const DIRECTORY = [
  { organisation_id: 'org-fictional-fintech-01', legal_name: 'Fictional Fintech One FZ-LLC' },
  { organisation_id: 'org-fictional-fintech-02', legal_name: 'Fictional Fintech Two Ltd' },
  { organisation_id: 'org-fictional-fintech-03', legal_name: 'Fictional Payments Co PSC' }
]

const simNebrasEgress: NebrasEgressPort = {
  async revokeConsent(consentId, reason, trace) {
    // All Nebras-bound traffic goes through this P6 adapter (no direct egress).
    // When the Nebras simulator service is reachable (NEBRAS_SIM_URL), propagate
    // the revoke to its Consent Manager so the <5s ack + fault injection
    // (revoke_delay) are exercised end to end; otherwise a deterministic ack.
    const base = process.env.NEBRAS_SIM_URL
    if (base) {
      const res = await fetch(`${base}/consent-manager/consents/${encodeURIComponent(consentId)}/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-fapi-interaction-id': trace.trace_id },
        body: JSON.stringify({ reason })
      })
      const body = (await res.json()) as { acknowledged_in_ms: number }
      return { acknowledged_in_ms: body.acknowledged_in_ms }
    }
    return { acknowledged_in_ms: 420 }
  },
  async fetchTppReports() {
    return { rows: [] }
  },
  async fetchDataset() {
    return { rows: [] }
  },
  async createDisputeCase() {
    return { nebras_case_id: nextId('nebras-case') }
  },
  async syncDirectory() {
    return { participants: DIRECTORY }
  }
}

const simLineage: LineagePort = {
  async emitLineage() {
    /* persisted to the lineage_events table once the db wiring lands (M1) */
  }
}

const simOnboardingHandover: OnboardingHandoverPort = {
  async getFunnelEvents() {
    return [
      { entry_path: 'DIRECT_SIGNUP', stage: 'kyc_complete', at: '2026-06-01T10:00:00Z' },
      { entry_path: 'ONBOARDING_HANDOVER', stage: 'handover_received', at: '2026-06-02T11:00:00Z' },
      { entry_path: 'ONBOARDING_HANDOVER', stage: 'activated', at: '2026-06-03T12:00:00Z' }
    ]
  }
}

const simFinancialSystem: FinancialSystemPort = {
  async registerCounterparty(org) {
    return { financial_system_ref: `fms-${org.organisation_id}` }
  },
  async issueInvoiceInstructions() {
    return { accepted: true }
  },
  async getSettlementStatus() {
    return { invoice_status: 'instructed' }
  }
}

export const SIM_ADAPTERS: PortMap = {
  'p1-care-surface': simCareSurface,
  'p2-identity-provider': simIdentityProvider,
  'p3-itsm': simItsm,
  'p4-core-banking': simCoreBanking,
  'p5-apm': simApm,
  'p6-nebras-egress': simNebrasEgress,
  'p7-lineage': simLineage,
  'p8-onboarding-handover': simOnboardingHandover,
  'p9-financial-system': simFinancialSystem
}
