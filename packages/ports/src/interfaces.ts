import type { Money, TraceContext } from './types.js'

/** P1 — Customer-Care Surface: short-lived tokens carrying act (agent) + sub (PSU),
 *  and on-demand resolution of a contact-centre recording for a dispute (BACKOFFICE-64).
 *  The Back Office links, never copies — resolveCallRecording returns a short-lived
 *  locator/reference into the bank's system, or null when no recording is available. */
export interface CareSurfacePort {
  mintCareToken(
    input: { agent_id: string; psu_id: string },
    trace: TraceContext
  ): Promise<{ token: string; act: string; sub: string; expires_at: string }>
  resolveCallRecording(
    input: { call_id: string },
    trace: TraceContext
  ): Promise<{ recording_ref: string; recording_url: string | null; expires_at: string } | null>
}

/** P2 — Enterprise IdP (OIDC): portal sign-in, MFA mandatory. */
export interface IdentityProviderPort {
  verifyToken(token: string): Promise<{ subject: string; persona: string; mfa: boolean }>
  personaLogins(): Promise<{ persona: string; display_name: string; demo_token: string }[]>
  /** ADR 0018 (Option 2) — mint a short-lived AGENT session token (token-exchange, RFC 8693)
   *  for an already-registered, ACTIVE automation. act = agent_id; scopes are the
   *  registration's bound scopes (a strict subset of a human persona; never
   *  platform:superadmin). The session_id + budget travel inside the token so the BFF can
   *  re-assert per-(agent_id, session_id) spend-control without trusting a client header.
   *  The demo (sim) mints an HMAC-signed token; the enterprise adapter (M6) mints a
   *  DCR client-credentials / mTLS token via the bank auth service (Option 1). */
  mintAgentSession(
    input: { agent_id: string; persona: string; scopes: string[]; allow_mutations: boolean; spend_budget: number },
    trace: TraceContext
  ): Promise<{ token: string; session_id: string; expires_at: string }>
  /** Verify an agent session token this port minted. Returns the claims, or null when the
   *  bearer is NOT an agent session token (so the human OIDC path handles it). Throws when
   *  the bearer IS an agent token but is tampered or expired — a forged or stale credential
   *  must be rejected, never silently downgraded to the human path. */
  verifyAgentSession(token: string): Promise<{
    agent_id: string
    persona: string
    session_id: string
    scopes: string[]
    allow_mutations: boolean
    spend_budget: number
    expires_at: string
  } | null>
}

/** P3 — ITSM & alerting: ticket creation with team routing. */
export interface ItsmPort {
  createTicket(
    input: { type: string; severity: 'low' | 'medium' | 'high' | 'critical'; team: string; summary: string },
    trace: TraceContext
  ): Promise<{ ticket_id: string }>
}

/** P4 — Core banking adapter: read-only reconciliation inputs. */
export interface CoreBankingPort {
  getBalance(accountRef: string, trace: TraceContext): Promise<{ balance: Money; as_of: string }>
  getTransactions(
    accountRef: string,
    window: { from: string; to: string },
    trace: TraceContext
  ): Promise<{ ref: string; amount: Money; booked_at: string }[]>
}

/** OTel span shape carried over the P5 bridge. trace_id IS x-fapi-interaction-id. */
export interface OtelSpan {
  name: string
  trace_id: string
  span_id: string
  parent_span_id?: string
  start_time: number
  end_time: number
  status_code: 'ok' | 'error'
  attributes: Record<string, string | number | boolean>
}

/** P5 — Enterprise APM: bridge off the OTel stream (never a second instrumentation path). */
export interface ApmPort {
  exportSpans(spans: OtelSpan[]): Promise<void>
}

/** P6 — Enterprise egress gateway: ALL Nebras-bound traffic. No direct egress — non-negotiable. */
export interface NebrasEgressPort {
  revokeConsent(
    consentId: string,
    reason: string,
    trace: TraceContext
  ): Promise<{ acknowledged_in_ms: number }>
  /** BACKOFFICE-32: TPP Reports / Dataset polling. published_at is the source
   *  roll-up timestamp (drives freshness). Throws on non-2xx (incl. 429 rate
   *  limit) so the ingestion job applies exponential back-off. */
  fetchTppReports(period: string, trace: TraceContext): Promise<{ published_at: string; rows: Record<string, unknown>[] }>
  fetchDataset(name: string, period: string, trace: TraceContext): Promise<{ published_at: string; rows: Record<string, unknown>[] }>
  createDisputeCase(payload: Record<string, unknown>, trace: TraceContext): Promise<{ nebras_case_id: string }>
  syncDirectory(trace: TraceContext): Promise<{ participants: { organisation_id: string; legal_name: string }[] }>
  /** BACKOFFICE-62: dispatch a refund via the formal Ozone Connect refund flow
   *  (GET /payment-consents/{consentId}/refund family) through the egress gateway;
   *  returns one of the 5 IPP status codes. */
  dispatchRefund(consentId: string, amount: Money, trace: TraceContext): Promise<{ ipp_status: string }>
  /** DEMO-08 — read a consent's current status from the Hub Consent Manager (via the
   *  egress gateway). The consent-drift monitor compares it to the platform's mirror; a
   *  mismatch (the Hub reports a status the platform doesn't hold) raises a drift signal. */
  getConsentStatus(consentId: string, trace: TraceContext): Promise<{ consent_id: string; status: string }>
}

/** P7 — Enterprise data catalogue: column-level BCBS 239 lineage at write time. */
export interface LineagePort {
  emitLineage(event: { table: string; columns: string[]; source: string; trace_id: string }): Promise<void>
}

export type OnboardingEntryPath = 'DIRECT_SIGNUP' | 'ONBOARDING_HANDOVER'

/** BACKOFFICE-34 — a single onboarding case journey for the funnel metrics:
 *  reached stages (a prefix of the canonical funnel order), the stage it abandoned
 *  at (null if it activated), timestamps for cycle time, and a cross-sell flag. */
export interface OnboardingCase {
  case_id: string
  entry_path: OnboardingEntryPath
  reached_stages: string[]
  abandoned_at_stage: string | null
  started_at: string
  activated_at: string | null
  cross_sell: boolean
}

/** P8 — Bank onboarding handover (optional port): funnel events with entry-path dimension. */
export interface OnboardingHandoverPort {
  getFunnelEvents(window: {
    from: string
    to: string
  }): Promise<{ entry_path: OnboardingEntryPath; stage: string; at: string }[]>
  /** BACKOFFICE-34 — per-case onboarding journeys for the five funnel metrics. */
  getOnboardingCases(window: { from: string; to: string }): Promise<OnboardingCase[]>
}

/** P9 — Financial management system: TPP counterparty registration + invoicing + settlement. */
export interface FinancialSystemPort {
  registerCounterparty(
    org: { organisation_id: string; legal_name: string },
    trace: TraceContext
  ): Promise<{ financial_system_ref: string }>
  issueInvoiceInstructions(
    run: { invoice_run_id: string; instructions: Record<string, unknown>[] },
    trace: TraceContext
  ): Promise<{ accepted: boolean }>
  getSettlementStatus(
    ref: string,
    trace: TraceContext
  ): Promise<{ invoice_status: 'instructed' | 'issued' | 'settled' | 'overdue' | 'credit_noted' }>
}

/** P10 — the bank's existing STR (Suspicious Transaction Report) workflow (ADR 0022,
 *  BACKOFFICE-63). The Back Office hands an APPROVED STR draft to this internal workflow,
 *  which is the system of record that submits to the CBUAE AML GO portal. The Back Office
 *  NEVER submits to AML GO directly — there is no AML GO client anywhere; the only call is
 *  this handoff. Returns the workflow's own reference for the accepted draft. No PII — the
 *  draft carries an internal consent ref + case context, never PSU identifiers. */
export interface StrWorkflowPort {
  handoffStrDraft(
    input: { str_draft_id: string; source_consent_id: string; case_context: string },
    trace: TraceContext
  ): Promise<{ workflow_ref: string; accepted_at: string }>
}

export interface PortMap {
  'p1-care-surface': CareSurfacePort
  'p2-identity-provider': IdentityProviderPort
  'p3-itsm': ItsmPort
  'p4-core-banking': CoreBankingPort
  'p5-apm': ApmPort
  'p6-nebras-egress': NebrasEgressPort
  'p7-lineage': LineagePort
  'p8-onboarding-handover': OnboardingHandoverPort
  'p9-financial-system': FinancialSystemPort
  'p10-str-workflow': StrWorkflowPort
}
