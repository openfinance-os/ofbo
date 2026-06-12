import type { Money, TraceContext } from './types.js'

/** P1 — Customer-Care Surface: short-lived tokens carrying act (agent) + sub (PSU). */
export interface CareSurfacePort {
  mintCareToken(
    input: { agent_id: string; psu_id: string },
    trace: TraceContext
  ): Promise<{ token: string; act: string; sub: string; expires_at: string }>
}

/** P2 — Enterprise IdP (OIDC): portal sign-in, MFA mandatory. */
export interface IdentityProviderPort {
  verifyToken(token: string): Promise<{ subject: string; persona: string; mfa: boolean }>
  personaLogins(): Promise<{ persona: string; display_name: string; demo_token: string }[]>
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
  fetchTppReports(period: string, trace: TraceContext): Promise<{ rows: Record<string, unknown>[] }>
  fetchDataset(name: string, period: string, trace: TraceContext): Promise<{ rows: Record<string, unknown>[] }>
  createDisputeCase(payload: Record<string, unknown>, trace: TraceContext): Promise<{ nebras_case_id: string }>
  syncDirectory(trace: TraceContext): Promise<{ participants: { organisation_id: string; legal_name: string }[] }>
}

/** P7 — Enterprise data catalogue: column-level BCBS 239 lineage at write time. */
export interface LineagePort {
  emitLineage(event: { table: string; columns: string[]; source: string; trace_id: string }): Promise<void>
}

/** P8 — Bank onboarding handover (optional port): funnel events with entry-path dimension. */
export interface OnboardingHandoverPort {
  getFunnelEvents(window: {
    from: string
    to: string
  }): Promise<{ entry_path: 'DIRECT_SIGNUP' | 'ONBOARDING_HANDOVER'; stage: string; at: string }[]>
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
}
