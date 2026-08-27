import type {
  ApmPort,
  CareSurfacePort,
  CoreBankingPort,
  FinancialSystemPort,
  EInvoicingAspPort,
  IdentityProviderPort,
  ItsmPort,
  LineagePort,
  NebrasEgressPort,
  OnboardingCase,
  OnboardingHandoverPort,
  PortMap,
  StrWorkflowPort
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
  ['platform-admin', 'OF Platform Administrator'],
  ['platform-super-admin', 'Platform Super Administrator']
] as const

const DEMO_TENANT_BANK_IDS: Readonly<Record<string, string>> = Object.freeze({
  'alpha-bank': '11111111-1111-4111-8111-111111111111',
  'beta-bank': '22222222-2222-4222-8222-222222222222',
  'gamma-takaful': '33333333-3333-4333-8333-333333333333'
})

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

/**
 * ADR 0018 (Option 2) — demo agent session token. An HMAC-signed, server-verifiable bearer
 * so that EVEN IN THE DEMO an agent identity cannot be forged: the BFF (which shares this
 * sim adapter) is the only party that can mint or verify it — there is no client-asserted
 * agent_id. Format: `agent-session.<payload-b64url>.<sig-b64url>`, payload = the claims JSON,
 * sig = HMAC-SHA256 over `agent-session.<payload-b64url>`. The enterprise adapter (M6) swaps
 * this for DCR client-credentials + mTLS (Option 1). Synthetic, non-prod key — never real.
 */
const AGENT_SESSION_PREFIX = 'agent-session.'
const AGENT_SESSION_TTL_MS = 15 * 60_000
const DEMO_AGENT_SESSION_KEY = 'ofbo-demo-agent-session-signing-key-synthetic-non-prod'

interface AgentSessionClaims {
  agent_id: string
  persona: string
  session_id: string
  scopes: string[]
  allow_mutations: boolean
  spend_budget: number
  bank_id?: string
  /** Absolute expiry (epoch ms). Short TTL; registry revoke denylists earlier (BACKOFFICE-60). */
  exp: number
}

const b64url = (bytes: ArrayBuffer | Uint8Array): string =>
  Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url')

function agentSessionKey() {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(DEMO_AGENT_SESSION_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

/** Constant-time compare — no early-out on the first differing byte (timing-safe). */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

async function signAgentSession(claims: AgentSessionClaims): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify(claims)))
  const body = AGENT_SESSION_PREFIX + payload
  const sig = await crypto.subtle.sign('HMAC', await agentSessionKey(), new TextEncoder().encode(body))
  return `${body}.${b64url(sig)}`
}

async function verifyAgentSessionToken(token: string): Promise<AgentSessionClaims | null> {
  if (!token.startsWith(AGENT_SESSION_PREFIX)) return null // not an agent token → human path handles it
  const parts = token.split('.') // ['agent-session', '<payload>', '<sig>'] — b64url never contains '.'
  if (parts.length !== 3) throw new Error('malformed agent session token')
  const [, payload, sig] = parts as [string, string, string]
  const body = `${AGENT_SESSION_PREFIX}${payload}`
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', await agentSessionKey(), new TextEncoder().encode(body)))
  const provided = new Uint8Array(Buffer.from(sig, 'base64url'))
  if (!constantTimeEqual(provided, expected)) throw new Error('agent session signature mismatch')
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AgentSessionClaims
  if (typeof claims.exp !== 'number' || claims.exp < Date.now()) throw new Error('agent session expired')
  return claims
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
    const match = /^demo-token:([^@]+)(?:@([a-z0-9-]+))?$/.exec(token)
    if (!match) throw new Error('unknown demo token')
    const persona = match[1]!
    const tenantSlug = match[2]
    if (!PERSONAS.some(([p]) => p === persona)) throw new Error('unknown demo token')
    // A token with no tenant suffix belongs to the DEFAULT demo tenant, not to no tenant at all.
    //
    // It used to mint no bank_id, and the whole LFI half of the Billing Control Plane is gated on
    // one: `tenantId()` in billing/console.ts throws BILLING_TENANT_REQUIRED without it. The
    // sign-in screen only ever offers unsuffixed tokens, so in the single-tenant demo — the
    // default deployment — every persona hit "A verified bank tenant claim is required for billing
    // access" and the console rendered empty. Only the flagged three-tenant demo could reach it.
    //
    // Alpha Bank IS the tenant in a single-tenant demo; the claim now says so. This does not widen
    // access: the same id already backs every seeded row, `bank_id` still carries no scope of its
    // own, and a suffixed token is still validated against the known tenants and still rejected
    // when the slug is unknown.
    const bank_id = tenantSlug ? DEMO_TENANT_BANK_IDS[tenantSlug] : DEMO_TENANT_BANK_IDS['alpha-bank']
    if (tenantSlug && !bank_id) throw new Error('unknown demo tenant claim')
    return { subject: `demo:${persona}${tenantSlug ? `@${tenantSlug}` : ''}`, persona, mfa: true, ...(bank_id ? { bank_id } : {}) }
  },
  // Token minting is non-deterministic by nature (fresh session_id + expiry per mint) — like
  // mintCareToken above. The signature makes the token unforgeable; the claims are verifiable.
  async mintAgentSession({ agent_id, persona, scopes, allow_mutations, spend_budget, bank_id }) {
    const session_id = crypto.randomUUID()
    const exp = Date.now() + AGENT_SESSION_TTL_MS
    const token = await signAgentSession({ agent_id, persona, session_id, scopes: [...scopes], allow_mutations, spend_budget, ...(bank_id ? { bank_id } : {}), exp })
    return { token, session_id, expires_at: new Date(exp).toISOString() }
  },
  async verifyAgentSession(token) {
    const claims = await verifyAgentSessionToken(token)
    if (!claims) return null
    return {
      agent_id: claims.agent_id,
      persona: claims.persona,
      session_id: claims.session_id,
      scopes: claims.scopes,
      allow_mutations: claims.allow_mutations,
      spend_budget: claims.spend_budget,
      ...(claims.bank_id ? { bank_id: claims.bank_id } : {}),
      expires_at: new Date(claims.exp).toISOString()
    }
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
  { organisation_id: 'org-tarabut-gateway', legal_name: 'Tarabut Gateway Ltd' },
  { organisation_id: 'org-lean-technologies', legal_name: 'Lean Technologies FZ-LLC' },
  { organisation_id: 'org-tabby', legal_name: 'Tabby FZ-LLC' }
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
  },
  async postJournalInstructions(batch) {
    const balanced = batch.journals.every((journal) => {
      const debit = journal.lines.filter((line) => line.side === 'debit').reduce((sum, line) => sum + line.amount_fils, 0)
      const credit = journal.lines.filter((line) => line.side === 'credit').reduce((sum, line) => sum + line.amount_fils, 0)
      return debit === credit
    })
    if (!balanced) throw new Error(`financial-system simulator rejected unbalanced batch ${batch.batch_id}`)
    return { accepted: true, journal_batch_ref: `fms-${batch.batch_id}` }
  },
  async dispatchPayableInstruction(instruction) {
    // Idempotent on the caller's key: a retried dispatch must not authorise the debit twice. The
    // simulator keeps the same guarantee the enterprise adapter is held to, since the contract suite
    // asserts it against both.
    const existing = simPayableDispatches.get(instruction.idempotency_key)
    if (existing) return { ...existing, replayed: true }
    if (!Number.isSafeInteger(instruction.amount_fils) || instruction.amount_fils <= 0) {
      throw new Error(`financial-system simulator rejected payable ${instruction.payable_id}: amount must be positive minor units`)
    }
    if (!instruction.approval_request_id.trim()) {
      // Fail closed. An unapproved payable reaching the financial system is the four-eyes gate being
      // bypassed downstream of the place that enforces it.
      throw new Error(`financial-system simulator rejected payable ${instruction.payable_id}: no approval reference`)
    }
    const result = {
      accepted: true,
      dispatch_ref: `fms-pay-${instruction.payable_id}`,
      payable_status: 'dispatched' as const,
      replayed: false
    }
    simPayableDispatches.set(instruction.idempotency_key, result)
    return result
  },
  async getPayableStatus(dispatch_ref) {
    for (const entry of simPayableDispatches.values()) {
      if (entry.dispatch_ref === dispatch_ref) return { payable_status: entry.payable_status }
    }
    // Deterministic for an unknown ref rather than inventing a lifecycle position.
    throw new Error(`financial-system simulator has no payable dispatch ${dispatch_ref}`)
  }
}

/** Keyed by idempotency key — the replay contract both adapters are held to. */
const simPayableDispatches = new Map<string, {
  accepted: boolean
  dispatch_ref: string
  payable_status: 'dispatched' | 'mandate_active' | 'presented' | 'collected' | 'rejected'
  replayed: boolean
}>()

// P10 — the bank's STR workflow. Records the handoff and returns a deterministic workflow
// reference; it NEVER calls the CBUAE AML GO portal (there is no AML GO client in the sim).
const simStrWorkflow: StrWorkflowPort = {
  async handoffStrDraft({ str_draft_id }) {
    return { workflow_ref: `str-wf-${str_draft_id}`, accepted_at: new Date().toISOString() }
  }
}

const simEInvoicingAsp: EInvoicingAspPort = {
  async submitDocument(document) {
    const valid = document.xml.includes(`<cbc:CustomizationID>${document.customization_id}</cbc:CustomizationID>`)
      && document.xml.includes(document.document_type === '380' ? '<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>' : '<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>')
      && new TextDecoder().decode(document.pdf.slice(0, 8)).startsWith('%PDF-1.')
    return {
      accepted: valid,
      submission_ref: `asp-sim-${document.document_id}`,
      document_status: valid ? 'accepted' : 'rejected',
      tdd_status: valid ? 'reported' : 'rejected'
    }
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
  'p9-financial-system': simFinancialSystem,
  'p10-str-workflow': simStrWorkflow,
  'p11-einvoicing-asp': simEInvoicingAsp
}
