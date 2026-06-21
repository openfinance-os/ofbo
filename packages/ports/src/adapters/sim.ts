import type {
  ApmPort,
  CareSurfacePort,
  CoreBankingPort,
  FinancialSystemPort,
  IdentityProviderPort,
  ItsmPort,
  LineagePort,
  NebrasEgressPort,
  OnboardingCase,
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
  },
  async resolveCallRecording({ call_id }) {
    // Demo: a deterministic short-lived locator into the (simulated) contact-centre
    // system. null for an empty call id (the enterprise adapter, M6, calls the real
    // recording system and may also return null when nothing is on file).
    if (!call_id) return null
    return {
      recording_ref: `rec-${call_id}`,
      recording_url: `https://contact-centre.demo/recordings/${encodeURIComponent(call_id)}`,
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

/** Thrown when the Nebras sim returns a non-2xx (e.g. 429 rate limit). The
 *  ingestion job (BACKOFFICE-32) treats it as retryable and backs off. */
export class NebrasEgressError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
    message: string
  ) {
    super(message)
    this.name = 'NebrasEgressError'
  }
}

const periodPublishedAt = (period: string): string =>
  /^\d{4}-\d{2}$/.test(period) ? `${period}-28T00:00:00.000Z` : `${period}T00:00:00.000Z`

/** Calls the Nebras simulator (P6 — all Nebras-bound traffic via this adapter).
 *  When NEBRAS_SIM_URL is unset (unit context), returns a deterministic empty
 *  snapshot so the adapter is self-contained; the integration path sets it. */
async function fetchNebras(
  path: string,
  trace: { trace_id: string },
  period: string
): Promise<{ published_at: string; rows: Record<string, unknown>[] }> {
  const base = process.env.NEBRAS_SIM_URL
  if (!base) return { published_at: periodPublishedAt(period), rows: [] }
  const res = await fetch(`${base}${path}`, { headers: { 'x-fapi-interaction-id': trace.trace_id } })
  if (!res.ok) {
    throw new NebrasEgressError(res.status, res.status === 429 || res.status >= 500, `Nebras egress ${path} → ${res.status}`)
  }
  const body = (await res.json()) as { published_at?: string; rows?: Record<string, unknown>[] }
  return { published_at: body.published_at ?? periodPublishedAt(period), rows: body.rows ?? [] }
}

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
  async fetchTppReports(period, trace) {
    return fetchNebras(`/tpp-reports/${encodeURIComponent(period)}`, trace, period)
  },
  async fetchDataset(name, period, trace) {
    return fetchNebras(`/datasets/${encodeURIComponent(name)}/${encodeURIComponent(period)}`, trace, period)
  },
  async createDisputeCase(payload, trace) {
    // All Nebras-bound traffic goes through this P6 adapter. When the simulator is
    // reachable (NEBRAS_SIM_URL), create the case on its Case & Dispute Management
    // surface end-to-end; otherwise a deterministic local id.
    const base = process.env.NEBRAS_SIM_URL
    if (base) {
      const res = await fetch(`${base}/case-management/disputes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-fapi-interaction-id': trace.trace_id },
        body: JSON.stringify(payload)
      })
      const body = (await res.json()) as { nebras_case_id: string }
      return { nebras_case_id: body.nebras_case_id }
    }
    return { nebras_case_id: nextId('nebras-case') }
  },
  async syncDirectory() {
    return { participants: DIRECTORY }
  },
  async dispatchRefund() {
    // Ozone Connect refund accepted into settlement processing (deterministic
    // for repeatable demos). The 5 IPP codes: ACCC, ACSP, ACSC, RJCT, PDNG.
    return { ipp_status: 'ACSP' }
  },
  async getConsentStatus(consentId, trace) {
    // All Nebras-bound traffic via this P6 adapter. When the sim is reachable, read the
    // Hub Consent Manager state (so an injected consent_drift fault is observed); otherwise
    // a deterministic 'Authorized' (no sim → no drift to detect).
    const base = process.env.NEBRAS_SIM_URL
    if (base) {
      const res = await fetch(`${base}/consent-manager/consents/${encodeURIComponent(consentId)}`, {
        headers: { 'x-fapi-interaction-id': trace.trace_id }
      })
      if (!res.ok) {
        throw new NebrasEgressError(res.status, res.status === 429 || res.status >= 500, `Nebras egress consent-status → ${res.status}`)
      }
      const body = (await res.json()) as { consent_id?: string; status?: string }
      return { consent_id: body.consent_id ?? consentId, status: body.status ?? 'Unknown' }
    }
    return { consent_id: consentId, status: 'Authorized' }
  }
}

const simLineage: LineagePort = {
  async emitLineage() {
    /* persisted to the lineage_events table once the db wiring lands (M1) */
  }
}

/** Deterministic onboarding cases for the funnel metrics: a fixed mix across both
 *  entry paths with completions, abandonments at each stage, and cross-sells —
 *  no randomness, so the demo repeats. started_at/activated_at drive cycle time.
 *  Canonical funnel stage order: initiated → kyc → consent_grant → activated. */
const ONBOARDING_CASES: OnboardingCase[] = [
  // DIRECT_SIGNUP — 3 activated (1 cross-sell), 1 abandoned at kyc, 1 at consent_grant
  { case_id: 'ob-ds-01', entry_path: 'DIRECT_SIGNUP', reached_stages: ['initiated', 'kyc', 'consent_grant', 'activated'], abandoned_at_stage: null, started_at: '2026-06-01T09:00:00.000Z', activated_at: '2026-06-01T21:00:00.000Z', cross_sell: true },
  { case_id: 'ob-ds-02', entry_path: 'DIRECT_SIGNUP', reached_stages: ['initiated', 'kyc', 'consent_grant', 'activated'], abandoned_at_stage: null, started_at: '2026-06-02T09:00:00.000Z', activated_at: '2026-06-02T18:00:00.000Z', cross_sell: false },
  { case_id: 'ob-ds-03', entry_path: 'DIRECT_SIGNUP', reached_stages: ['initiated', 'kyc', 'consent_grant', 'activated'], abandoned_at_stage: null, started_at: '2026-06-03T09:00:00.000Z', activated_at: '2026-06-03T15:00:00.000Z', cross_sell: false },
  { case_id: 'ob-ds-04', entry_path: 'DIRECT_SIGNUP', reached_stages: ['initiated', 'kyc'], abandoned_at_stage: 'kyc', started_at: '2026-06-04T09:00:00.000Z', activated_at: null, cross_sell: false },
  { case_id: 'ob-ds-05', entry_path: 'DIRECT_SIGNUP', reached_stages: ['initiated', 'kyc', 'consent_grant'], abandoned_at_stage: 'consent_grant', started_at: '2026-06-05T09:00:00.000Z', activated_at: null, cross_sell: false },
  // ONBOARDING_HANDOVER — 2 activated (1 cross-sell, faster cycle), 1 abandoned at kyc
  { case_id: 'ob-ho-01', entry_path: 'ONBOARDING_HANDOVER', reached_stages: ['initiated', 'kyc', 'consent_grant', 'activated'], abandoned_at_stage: null, started_at: '2026-06-02T08:00:00.000Z', activated_at: '2026-06-02T12:00:00.000Z', cross_sell: true },
  { case_id: 'ob-ho-02', entry_path: 'ONBOARDING_HANDOVER', reached_stages: ['initiated', 'kyc', 'consent_grant', 'activated'], abandoned_at_stage: null, started_at: '2026-06-03T08:00:00.000Z', activated_at: '2026-06-03T11:00:00.000Z', cross_sell: false },
  { case_id: 'ob-ho-03', entry_path: 'ONBOARDING_HANDOVER', reached_stages: ['initiated', 'kyc'], abandoned_at_stage: 'kyc', started_at: '2026-06-04T08:00:00.000Z', activated_at: null, cross_sell: false }
]

const simOnboardingHandover: OnboardingHandoverPort = {
  async getFunnelEvents() {
    return [
      { entry_path: 'DIRECT_SIGNUP', stage: 'kyc_complete', at: '2026-06-01T10:00:00Z' },
      { entry_path: 'ONBOARDING_HANDOVER', stage: 'handover_received', at: '2026-06-02T11:00:00Z' },
      { entry_path: 'ONBOARDING_HANDOVER', stage: 'activated', at: '2026-06-03T12:00:00Z' }
    ]
  },
  async getOnboardingCases() {
    return ONBOARDING_CASES.map((c) => ({ ...c, reached_stages: [...c.reached_stages] }))
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
