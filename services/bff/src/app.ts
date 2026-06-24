import { Hono } from 'hono'
import { matchRoute, ROUTES } from '@ofbo/contracts'
import type { ApmPort, CareSurfacePort, IdentityProviderPort, NebrasEgressPort, OnboardingHandoverPort } from '@ofbo/ports'
import { getAdapter, profileFromConfig } from '@ofbo/ports'
import { errorEnvelope, DOCS_BASE } from './envelope.js'
import { createAuthMiddleware, InMemoryAuthAuditSink, type AuthAuditSink } from './auth.js'
import { assertScope, createScopeMiddleware, isDynamicScope, scopeDenialEnvelope, ScopeDeniedError } from './rbac.js'
import { ApprovalsService, type ApprovalsDeps } from './approvals/service.js'
import {
  createJustificationMiddleware,
  isServiceAccountSubject,
  InMemoryRiskSignalSink,
  SuperAdminGuardrails,
  type SuperAdminDeps
} from './superadmin.js'
import { approvalRoutes } from './approvals/routes.js'
import { consentRoutes } from './consents/routes.js'
import { ConsentSearchService } from './consents/service.js'
import { DemoConsentDirectory, RevocableConsentDirectory, type ConsentDirectory } from './consents/directory.js'
import {
  ConsentAuditTrailService,
  consentAuditTrailRoutes,
  InMemoryConsentEventSource,
  type ConsentEventSource
} from './consents/audit-trail.js'
import { ConsentRevokeService, consentRevokeRoutes } from './consents/revoke.js'
import { CareSurfaceService } from './care-surface/service.js'
import { careSurfaceRoutes } from './care-surface/routes.js'
import {
  ConsentFraudRevokeService,
  consentFraudRevokeRoutes,
  makeFraudRevokeOperation,
  FRAUD_REVOKE_OPERATION
} from './consents/fraud-revoke.js'
import {
  ConsentBulkRevokeService,
  consentBulkRevokeRoutes,
  makeBulkRevokeOperation,
  BULK_REVOKE_OPERATION
} from './consents/bulk-revoke.js'
import {
  RegisterQueryPurposeService,
  registerQueryPurposeRoutes,
  makeRegisterQueryPurposeOperation,
  InMemoryQueryPurposeRegistrar,
  QUERY_PURPOSE_REGISTER_OPERATION,
  type QueryPurposeRegistrar
} from './governance/query-purposes.js'
import { DisputeService, InMemoryDisputeStore, makeRefundOperation, REFUND_OPERATION, type DisputeStore } from './disputes/service.js'
import { disputeRoutes } from './disputes/routes.js'
import { CallRecordingService, callRecordingRoutes } from './disputes/call-recording.js'
import { RespondentDisputeService, InMemoryRespondentDisputeStore, type RespondentDisputeStore } from './respondent-disputes/service.js'
import { respondentDisputeRoutes } from './respondent-disputes/routes.js'
import { FraudIncidentService, InMemoryFraudIncidentStore, type FraudIncidentStore } from './fraud-incidents/service.js'
import { fraudIncidentRoutes } from './fraud-incidents/routes.js'
import {
  AgentRegistryService,
  InMemoryAgentStore,
  makeAgentRegisterOperation,
  AGENT_REGISTER_OPERATION,
  type AgentStore
} from './agents/service.js'
import { agentRoutes } from './agents/routes.js'
import { AgentSpendLedger, createAgentSpendMiddleware } from './agents/spend.js'
import { SchemeNotificationService, InMemorySchemeNotificationStore, type SchemeNotificationStore } from './scheme-notifications/service.js'
import { schemeNotificationRoutes } from './scheme-notifications/routes.js'
import { DemoPaymentDirectory, type PaymentSource } from './disputes/payments.js'
import {
  InquiryBundleService,
  InMemoryComplianceReportStore,
  inquiryRoutes,
  type ComplianceReportStore
} from './inquiries/bundle.js'
import {
  ReconciliationService,
  InMemoryReconciliationLogStore,
  InMemoryReconciliationBreakStore,
  makeBreakReopenOperation,
  BREAK_REOPEN_OPERATION,
  makeMonthlySignoffOperation,
  MONTHLY_SIGNOFF_OPERATION,
  InMemoryReconciliationThresholdStore,
  type ReconciliationLogStore,
  type ReconciliationBreakStore,
  type ThresholdStore
} from './reconciliation/service.js'
import { reconciliationRoutes } from './reconciliation/routes.js'
import { TppRegistryService, InMemoryTppCounterpartyStore, type TppCounterpartyStore } from './tpp-billing/service.js'
import { tppBillingRoutes, tppInvoicingRoutes } from './tpp-billing/routes.js'
import { FinanceViewService, financeViewRoutes, type FinanceFeeAccrualReader } from './analytics/finance-view.js'
import {
  OperationsConsoleService,
  operationsConsoleRoutes,
  type OpsCertificationReader,
  type OpsOutageReader,
  type OpsConnectivityReader
} from './analytics/operations-console.js'
import {
  ComplianceViewService,
  complianceViewRoutes,
  type ComplianceMetricsReader,
  type RetentionReader
} from './analytics/compliance-view.js'
import { RiskViewService, riskViewRoutes, type RiskMetricsReader } from './analytics/risk-view.js'
import { RiskSignalService, InMemoryRiskSignalStore, type RiskSignalStore } from './risk-signals/service.js'
import { riskSignalRoutes } from './risk-signals/routes.js'
import { LineageService, InMemoryLineageReader, type LineageReader } from './lineage/service.js'
import { lineageRoutes } from './lineage/routes.js'
import { ReconciliationSloService, reconciliationSloRoutes } from './analytics/reconciliation-slo.js'
import { LiabilityViewService, liabilityMonitorRoutes } from './risk/liability.js'
import { LiabilityForecastService, DemoLiabilityTelemetrySource } from './risk/liability-forecast.js'
import { ProgrammeReportService } from './analytics/programme.js'
import { AuditEventsService, auditEventsRoutes, InMemoryAuditEventReader, type AuditEventReader } from './audit/events.js'
import { ExecutiveDashboardService, executiveDashboardRoutes } from './analytics/executive-dashboard.js'
import { OnboardingFunnelService, onboardingFunnelRoutes, type OnboardingCaseReader } from './analytics/onboarding-funnel.js'
import { AnalyticsExportService, analyticsExportRoutes, type ViewDataSource } from './analytics/exports.js'
import {
  ReportGenerationService,
  reportRoutes,
  makeReportGenerationOperation,
  InMemoryReportStore,
  REPORT_GENERATION_OPERATION,
  type ReportStore
} from './reports/generation.js'
import {
  InvoicingService,
  InMemoryBillingRecordStore,
  InMemoryInvoiceRunStore,
  makeInvoiceRunOperation,
  INVOICE_RUN_OPERATION,
  type BillingRecordStore,
  type InvoiceRunStore
} from './tpp-billing/invoicing.js'
import { LfiReportService } from './lfi-reports/service.js'
import { lfiReportRoutes } from './lfi-reports/routes.js'
import { TrustFrameworkService, InMemoryTrustFrameworkParticipantStore, type TrustFrameworkParticipantStore } from './trust-framework/service.js'
import { trustFrameworkRoutes } from './trust-framework/routes.js'
import { ServiceDeskService, InMemoryServiceDeskCaseStore, type ServiceDeskCaseStore } from './service-desk/service.js'
import { serviceDeskRoutes } from './service-desk/routes.js'
import { hasHighClassEmit, InMemoryHighClassAuditSink, type HighClassAuditSink } from './high-class-audit.js'
import { createTelemetryMiddleware } from './telemetry.js'
import { IdempotencyCache, type IdempotencyStore } from './idempotency.js'

/** Route keys (`method path`) handled by real story services — used by the test
 *  suites to exclude them from the contract-pending it.fails layer. */
export const IMPLEMENTED_ROUTES = new Set([
  'post /approvals',
  'get /approvals/pending',
  'get /approvals/{approval_id}',
  'post /approvals/{approval_id}:approve',
  'post /approvals/{approval_id}:reject',
  'post /care-surface:mint-token',
  'get /consents:search-psu',
  'get /consents/{consent_id}:admin',
  'post /consents/{consent_id}:revoke-admin',
  'post /consents:revoke-bulk',
  'post /consents/{consent_id}:revoke-fraud',
  'post /back-office/governance/query-purposes',
  'get /consents/{consent_id}/audit-trail',
  'get /psu/{psu_identifier}/audit-trail',
  'get /payments/{payment_id}:admin',
  'post /disputes',
  'get /disputes',
  'patch /disputes/{dispute_id}',
  'get /disputes/{dispute_id}/call-recording',
  'post /disputes/{dispute_id}:initiate-refund',
  'post /back-office/disputes/{dispute_id}:record-cross-scheme',
  'post /back-office/disputes/respondent',
  'get /back-office/disputes/respondent',
  'get /back-office/disputes/respondent/{respondent_dispute_id}',
  'post /back-office/disputes/respondent/{respondent_dispute_id}:advance',
  'post /back-office/fraud-incidents',
  'get /back-office/fraud-incidents',
  'post /back-office/fraud-incidents/{incident_id}:resolve',
  'post /back-office/scheme-notifications',
  'get /back-office/scheme-notifications',
  'post /back-office/scheme-notifications/{notification_id}:acknowledge',
  'post /back-office/inquiries/psu',
  'get /back-office/reconciliation/runs',
  'get /back-office/reconciliation/runs/{run_id}',
  'post /back-office/reconciliation/runs:replay',
  'get /back-office/reconciliation/breaks',
  'get /back-office/reconciliation/breaks/{break_id}',
  'post /back-office/reconciliation/breaks/{break_id}/claim',
  'post /back-office/reconciliation/breaks/{break_id}/resolve',
  'post /back-office/reconciliation/breaks/{break_id}/reopen',
  'post /back-office/reconciliation/breaks/{break_id}/escalate-nebras',
  'post /back-office/reconciliation/monthly-signoff',
  'get /back-office/reconciliation/thresholds',
  'put /back-office/reconciliation/thresholds',
  'get /back-office/reconciliation/exports:cbuae',
  'get /back-office/tpp-counterparties',
  'get /back-office/tpp-counterparties/{organisation_id}',
  'post /back-office/tpp-counterparties:sync-directory',
  'post /back-office/tpp-counterparties/{organisation_id}:register-financial-system',
  'get /back-office/billing-records',
  'post /back-office/billing-records',
  'post /back-office/billing-records/{record_set_id}:reconcile',
  'get /back-office/invoice-runs',
  'post /back-office/invoice-runs',
  'get /back-office/invoice-runs/{invoice_run_id}',
  'get /back-office/analytics/finance-view',
  'get /back-office/analytics/operations-console',
  'get /back-office/analytics/compliance-view',
  'get /back-office/risk-signals',
  'patch /back-office/risk-signals/{signal_id}',
  'get /back-office/lineage/{table_name}',
  'get /back-office/analytics/risk-view',
  'get /back-office/analytics/reconciliation-slo',
  'get /back-office/analytics/nebras-liability-monitor',
  'get /back-office/analytics/executive-dashboard',
  'get /back-office/analytics/onboarding-funnel',
  'post /back-office/analytics/exports',
  'get /back-office/lfi-reports',
  'post /back-office/lfi-reports',
  'get /back-office/trust-framework/participants',
  'post /back-office/trust-framework/participants',
  'get /back-office/trust-framework/participants/{participant_id}',
  'post /back-office/trust-framework/participants/{participant_id}:nominate-replacement',
  'get /back-office/service-desk-cases',
  'post /back-office/service-desk-cases',
  'get /back-office/service-desk-cases/{case_id}',
  'post /back-office/service-desk-cases/{case_id}:update',
  'post /back-office/reports:generate',
  'get /back-office/reports',
  'get /back-office/reports/{report_id}',
  'get /back-office/reports/{report_id}/download',
  'post /back-office/reports/{report_id}:approve',
  'post /back-office/reports/{report_id}:submit',
  'get /audit/events',
  'get /audit/events/{event_id}',
  'post /back-office/agents:register',
  'get /back-office/agents',
  'get /back-office/agents/{agent_id}',
  'post /back-office/agents/{agent_id}:revoke',
  'post /back-office/agents/{agent_id}:mint-session'
])

/**
 * Stub BFF: every contract path resolves (via the colon-action-safe matcher,
 * NOT framework path syntax) and returns the binding 501 envelope. Stories
 * replace stubs route-by-route; the [contract-pending] it.fails suite enforces
 * that flip. Since BACKOFFICE-47, every request authenticates via the IdP
 * port (P2) — MFA mandatory, scopes minted from the §2 persona matrix.
 */
export interface AppDeps {
  idp?: IdentityProviderPort
  audit?: AuthAuditSink
  approvals?: ApprovalsDeps
  superadmin?: Partial<SuperAdminDeps>
  apm?: Pick<ApmPort, 'exportSpans'>
  careSurface?: Pick<CareSurfacePort, 'mintCareToken' | 'resolveCallRecording'>
  idempotency?: IdempotencyStore
  /** High-class audit for story services (BACKOFFICE-16+). Defaults to `audit`
   *  when it exposes emit (PgAuditEmitter does), else an in-memory sink. */
  highClassAudit?: HighClassAuditSink
  consentDirectory?: ConsentDirectory
  consentEventSource?: ConsentEventSource
  nebrasEgress?: Pick<NebrasEgressPort, 'revokeConsent' | 'createDisputeCase' | 'dispatchRefund'>
  disputeStore?: DisputeStore
  paymentSource?: PaymentSource
  complianceReportStore?: ComplianceReportStore
  reconciliationLogStore?: ReconciliationLogStore
  reconciliationBreakStore?: ReconciliationBreakStore
  reconciliationThresholdStore?: ThresholdStore
  tppCounterpartyStore?: TppCounterpartyStore
  /** BACKOFFICE-71 — P6 Trust Framework Directory source (defaults to the P6 adapter). */
  tppDirectoryEgress?: Pick<NebrasEgressPort, 'syncDirectory'>
  billingRecordStore?: BillingRecordStore
  invoiceRunStore?: InvoiceRunStore
  /** BACKOFFICE-35 — report-generation store (defaults in-memory; worker wires the Pg
   *  compliance_report store, shared with the inquiry bundle). */
  /** BACKOFFICE-75 — respondent-side Nebras dispute store (defaults in-memory; the
   *  worker wires the durable PgRespondentDisputeStore). */
  respondentDisputeStore?: RespondentDisputeStore
  /** BACKOFFICE-77 — fraud-incident store (defaults in-memory; the worker wires the
   *  durable PgFraudIncidentStore). */
  fraudIncidentStore?: FraudIncidentStore
  /** BACKOFFICE-60 — agent DCR registry store (defaults in-memory; the worker wires the
   *  durable Pg store). */
  agentStore?: AgentStore
  /** BACKOFFICE-78 — outbound scheme-notification store (defaults in-memory; the
   *  worker wires the durable PgSchemeNotificationStore). */
  schemeNotificationStore?: SchemeNotificationStore
  /** BACKOFFICE-74 — Trust Framework participant store (defaults in-memory; the worker
   *  wires the durable PgTrustFrameworkParticipantStore). */
  trustFrameworkStore?: TrustFrameworkParticipantStore
  /** BACKOFFICE-79 — Nebras service-desk case store (defaults in-memory; the worker
   *  wires the durable PgServiceDeskCaseStore). */
  serviceDeskStore?: ServiceDeskCaseStore
  reportStore?: ReportStore
  /** BACKOFFICE-42 — audit-trail drill-down reader (defaults in-memory; worker wires PgAuditReader). */
  auditEventReader?: AuditEventReader
  /** BACKOFFICE-31 — Finance View fee-accrual source (the BACKOFFICE-32 materialized
   *  aggregates). Defaults to an empty reader; the worker wires the Pg aggregate store. */
  nebrasAggregateReader?: FinanceFeeAccrualReader
  /** BACKOFFICE-28 — Operations Console sources. Default to empty readers; the worker
   *  wires the Pg certification / outage / snapshot stores. */
  certificationReader?: OpsCertificationReader
  outageReader?: OpsOutageReader
  nebrasConnectivityReader?: OpsConnectivityReader
  /** BACKOFFICE-28 — P8 onboarding-handover source (defaults to the P8 adapter). */
  onboardingHandover?: Pick<OnboardingHandoverPort, 'getFunnelEvents'>
  /** BACKOFFICE-34 — P8 onboarding-case source for the funnel metrics (defaults to the P8 adapter). */
  onboardingCaseReader?: OnboardingCaseReader
  /** BACKOFFICE-29 — Compliance View sources. Default to empty readers; the worker
   *  wires the Pg compliance-metrics store + retention reader. */
  complianceMetricsReader?: ComplianceMetricsReader
  retentionReader?: RetentionReader
  /** BACKOFFICE-33 PR 5 — registrar for four-eyes query-purpose registration (defaults
   *  in-memory for the demo profile; the worker wires PgQueryPurposeRegistrar). */
  queryPurposeRegistrar?: QueryPurposeRegistrar
  /** BACKOFFICE-30 — Risk View source (risk_signal aggregates). Default empty reader;
   *  the worker wires the Pg risk-metrics store. */
  riskMetricsReader?: RiskMetricsReader
  /** BACKOFFICE-30/-42 — risk-signal list/triage store (defaults in-memory; the worker
   *  wires PgRiskMetricsStore, which satisfies list/get/updateStatus). */
  riskSignalStore?: RiskSignalStore
  /** BACKOFFICE-49 — lineage reader for GET /lineage/{table_name} (defaults in-memory;
   *  the worker wires PgLineageReader). */
  lineageReader?: LineageReader
}

/** The immutable synthetic seed, built once per isolate (the dataset is deterministic so a
 *  Worker that handles many requests pays the tiny build once). Each createApp() wraps it in
 *  a fresh per-app RevocableConsentDirectory overlay (DEMO fidelity) so a revoke reflects on
 *  re-lookup within the running process WITHOUT mutating the shared seed (tests stay isolated). */
let demoConsentSeed: ConsentDirectory | undefined
function sharedDemoConsentSeed(): ConsentDirectory {
  return (demoConsentSeed ??= new DemoConsentDirectory())
}

let demoPaymentDirectory: PaymentSource | undefined
function sharedDemoPaymentDirectory(): PaymentSource {
  return (demoPaymentDirectory ??= new DemoPaymentDirectory())
}

export function createApp(deps: AppDeps = {}) {
  const idp = deps.idp ?? getAdapter('p2-identity-provider', profileFromConfig(process.env))
  const audit = deps.audit ?? new InMemoryAuthAuditSink()
  // Shared P3 ITSM + Risk-signal sinks (BACKOFFICE-80). Reused by the super-admin guardrails
  // AND the agent spend-control auto-raise (BACKOFFICE-53 / ADR 0018) — one place an
  // agent_anomaly lands, the same place the Risk View reads.
  const itsmPort = deps.superadmin?.itsm ?? getAdapter('p3-itsm', profileFromConfig(process.env))
  const riskSignalSink = deps.superadmin?.riskSignals ?? new InMemoryRiskSignalSink()
  const guardrails = new SuperAdminGuardrails({
    itsm: itsmPort,
    riskSignals: riskSignalSink,
    ...(deps.superadmin?.sessionTtlMs !== undefined ? { sessionTtlMs: deps.superadmin.sessionTtlMs } : {})
  })
  // High-class audit for story services: prefer an explicit sink, else reuse the
  // auth audit when it exposes emit (PgAuditEmitter does), else in-memory.
  const highClassAudit: HighClassAuditSink =
    deps.highClassAudit ?? (hasHighClassEmit(audit) ? audit : new InMemoryHighClassAuditSink())
  const consentDirectory = deps.consentDirectory ?? new RevocableConsentDirectory(sharedDemoConsentSeed())
  const consentSearch = new ConsentSearchService({
    audit: highClassAudit,
    directory: consentDirectory
  })
  const auditTrail = new ConsentAuditTrailService(deps.consentEventSource ?? new InMemoryConsentEventSource())
  const nebrasEgress = deps.nebrasEgress ?? getAdapter('p6-nebras-egress', profileFromConfig(process.env))
  const revokeService = new ConsentRevokeService({ egress: nebrasEgress, audit: highClassAudit, directory: consentDirectory })
  const careSurface = deps.careSurface ?? getAdapter('p1-care-surface', profileFromConfig(process.env))
  const careSurfaceService = new CareSurfaceService({ careSurface, directory: consentDirectory, audit: highClassAudit })

  // Stores that four-eyes operations close over are built before the approvals
  // service so the operations can be registered: the refund op needs the dispute
  // store, the reopen op (BACKOFFICE-04) needs the reconciliation break store.
  const disputeStore = deps.disputeStore ?? new InMemoryDisputeStore()
  const callRecordingService = new CallRecordingService({ store: disputeStore, careSurface, audit: highClassAudit })
  const reconciliationBreakStore = deps.reconciliationBreakStore ?? new InMemoryReconciliationBreakStore()
  const invoiceRunStore = deps.invoiceRunStore ?? new InMemoryInvoiceRunStore()
  const reportStore = deps.reportStore ?? new InMemoryReportStore()
  const reportGenerationOperation = makeReportGenerationOperation({ store: reportStore })
  const refundOperation = makeRefundOperation({ store: disputeStore, egress: nebrasEgress, audit: highClassAudit })
  const fraudRevokeOperation = makeFraudRevokeOperation({ egress: nebrasEgress, audit: highClassAudit, directory: consentDirectory })
  const queryPurposeRegistrar = deps.queryPurposeRegistrar ?? new InMemoryQueryPurposeRegistrar()
  const registerQueryPurposeOperation = makeRegisterQueryPurposeOperation({ registrar: queryPurposeRegistrar, audit: highClassAudit })
  const bulkRevokeOperation = makeBulkRevokeOperation({ directory: consentDirectory, egress: nebrasEgress, audit: highClassAudit })
  const breakReopenOperation = makeBreakReopenOperation({ breakStore: reconciliationBreakStore, audit: highClassAudit })
  const invoiceRunOperation = makeInvoiceRunOperation({ invoiceStore: invoiceRunStore, financialSystem: getAdapter('p9-financial-system', profileFromConfig(process.env)), audit: highClassAudit })
  // BACKOFFICE-06 — the monthly sign-off operation executes on the reconciliation service,
  // which is constructed below (it needs `approvals`). Late-bind via this holder to break the
  // request↔execute cycle; the closure runs only at approval time, after svc is set.
  const reconHolder: { svc?: ReconciliationService } = {}
  const monthlySignoffOperation = makeMonthlySignoffOperation({
    execute: (period, by, persona, trace) => reconHolder.svc!.executeMonthlySignoff(period, by, persona, trace)
  })
  // BACKOFFICE-60 — agent DCR registration is four-eyes; the credential is issued only on
  // the second principal's approval (makeAgentRegisterOperation.execute).
  const agentStore = deps.agentStore ?? new InMemoryAgentStore()
  const agentRegisterOperation = makeAgentRegisterOperation({ store: agentStore, audit: highClassAudit })
  const approvals = new ApprovalsService(audit, {
    ...deps.approvals,
    operations: {
      ...deps.approvals?.operations,
      [REFUND_OPERATION]: refundOperation,
      [FRAUD_REVOKE_OPERATION]: fraudRevokeOperation,
      [QUERY_PURPOSE_REGISTER_OPERATION]: registerQueryPurposeOperation,
      [BULK_REVOKE_OPERATION]: bulkRevokeOperation,
      [BREAK_REOPEN_OPERATION]: breakReopenOperation,
      [MONTHLY_SIGNOFF_OPERATION]: monthlySignoffOperation,
      [INVOICE_RUN_OPERATION]: invoiceRunOperation,
      [REPORT_GENERATION_OPERATION]: reportGenerationOperation,
      [AGENT_REGISTER_OPERATION]: agentRegisterOperation
    }
  })
  const agentRegistryService = new AgentRegistryService(approvals, agentStore, highClassAudit, idp)
  const fraudRevokeService = new ConsentFraudRevokeService(approvals)
  const registerQueryPurposeService = new RegisterQueryPurposeService(approvals)
  const bulkRevokeService = new ConsentBulkRevokeService(approvals, consentDirectory)
  const paymentSource = deps.paymentSource ?? sharedDemoPaymentDirectory()
  const disputeService = new DisputeService({
    store: disputeStore,
    payments: paymentSource,
    egress: nebrasEgress,
    audit: highClassAudit,
    approvals
  })
  // BACKOFFICE-75 — respondent-side Nebras dispute scheme clocks (Finance-owned).
  const respondentDisputeService = new RespondentDisputeService({
    store: deps.respondentDisputeStore ?? new InMemoryRespondentDisputeStore(),
    audit: highClassAudit
  })
  // BACKOFFICE-77 — Nebras fraud-incident reporting + scheme-imposed holds (Risk-owned).
  const fraudIncidentService = new FraudIncidentService({
    store: deps.fraudIncidentStore ?? new InMemoryFraudIncidentStore(),
    itsm: deps.superadmin?.itsm ?? getAdapter('p3-itsm', profileFromConfig(process.env)),
    audit: highClassAudit
  })
  // BACKOFFICE-78 — outbound downtime/change notifications to Nebras (Operations-owned).
  const schemeNotificationService = new SchemeNotificationService({
    store: deps.schemeNotificationStore ?? new InMemorySchemeNotificationStore(),
    audit: highClassAudit
  })
  const complianceReportStore = deps.complianceReportStore ?? new InMemoryComplianceReportStore()
  const inquiryService = new InquiryBundleService({
    consents: consentDirectory,
    payments: paymentSource,
    disputes: disputeStore,
    events: deps.consentEventSource ?? new InMemoryConsentEventSource(),
    reports: complianceReportStore,
    audit: highClassAudit
  })
  const apm = deps.apm ?? getAdapter('p5-apm', profileFromConfig(process.env))
  const reconciliationLogStore = deps.reconciliationLogStore ?? new InMemoryReconciliationLogStore()
  const reconciliationThresholdStore = deps.reconciliationThresholdStore ?? new InMemoryReconciliationThresholdStore()
  const reconciliationService = new ReconciliationService({
    store: reconciliationLogStore,
    breakStore: reconciliationBreakStore,
    thresholdStore: reconciliationThresholdStore,
    itsm: deps.superadmin?.itsm ?? getAdapter('p3-itsm', profileFromConfig(process.env)),
    approvals,
    egress: nebrasEgress,
    apm,
    reports: complianceReportStore,
    audit: highClassAudit
  })
  reconHolder.svc = reconciliationService // BACKOFFICE-06 — bind the monthly-signoff executor
  const tppCounterpartyStore = deps.tppCounterpartyStore ?? new InMemoryTppCounterpartyStore()
  const tppRegistryService = new TppRegistryService(
    tppCounterpartyStore,
    deps.tppDirectoryEgress ?? getAdapter('p6-nebras-egress', profileFromConfig(process.env)),
    highClassAudit,
    getAdapter('p9-financial-system', profileFromConfig(process.env)),
    deps.superadmin?.itsm ?? getAdapter('p3-itsm', profileFromConfig(process.env))
  )
  const invoicingService = new InvoicingService({
    billingStore: deps.billingRecordStore ?? new InMemoryBillingRecordStore(),
    invoiceStore: invoiceRunStore,
    breakSink: reconciliationBreakStore,
    approvals,
    audit: highClassAudit
  })
  // BACKOFFICE-31 — Finance View composes persisted data under one read scope:
  // fee accrual (BACKOFFICE-32 aggregates), margin (BACKOFFICE-07), the open Nebras
  // dispute queue, and the unbilled-traffic signal (BACKOFFICE-72, aggregate count).
  const financeViewService = new FinanceViewService({
    feeAccrual: deps.nebrasAggregateReader ?? { feeAccrualForPeriod: async () => null },
    margin: reconciliationService,
    disputes: reconciliationService,
    unbilled: { unbilledTrafficCount: async () => (await tppCounterpartyStore.list({ unbilled_traffic: true, limit: 200 })).rows.length }
  })
  // Shared analytics readers (BACKOFFICE-28/-29/-30/-27): the TPP onboarding pipeline
  // (registration-state counts), certification per role, the P8 onboarding-handover
  // source, and the compliance-metrics reader — composed by several views.
  const onboardingHandover = deps.onboardingHandover ?? getAdapter('p8-onboarding-handover', profileFromConfig(process.env))
  const certificationReader = deps.certificationReader ?? { list: async () => [] }
  const pipelineReader = {
    pipelineCounts: async () => {
      const { rows } = await tppCounterpartyStore.list({ limit: 200 })
      return rows.reduce<Record<string, number>>((acc, r) => ((acc[r.registration_state] = (acc[r.registration_state] ?? 0) + 1), acc), {})
    }
  }
  const emptyMetrics: ComplianceMetricsReader = {
    consentVolumes: async () => ({ total: 0, by_event_type: {} }),
    disputeBacklog: async () => ({ open: 0, by_state: {} }),
    riskSignalBacklog: async () => ({ open: 0, by_severity: {} }),
    reportLibrary: async () => ({ by_status: {}, by_type: {}, recent_inquiries: [] })
  }
  const complianceMetrics = deps.complianceMetricsReader ?? emptyMetrics
  // BACKOFFICE-28 — Operations Console: certification per role + active outages composed
  // with the TPP onboarding pipeline, P8 handover health, Nebras connectivity (latest snapshot).
  const operationsConsoleService = new OperationsConsoleService({
    certifications: certificationReader,
    outages: deps.outageReader ?? { listActive: async () => [] },
    connectivity: deps.nebrasConnectivityReader ?? { latest: async () => null },
    pipeline: pipelineReader,
    handover: onboardingHandover
  })
  // BACKOFFICE-29 — Compliance View: regulatory posture over existing tables
  // (consent volumes, retention lifecycle, dispute + risk-signal backlog, report library).
  const complianceViewService = new ComplianceViewService({
    metrics: complianceMetrics,
    retention: deps.retentionReader ?? { retentionStatus: async () => [] }
  })
  // BACKOFFICE-30 — Risk View over risk_signal aggregates (anomalies + liability monitor).
  const riskMetricsReader = deps.riskMetricsReader ?? {
    summary: async () => ({ active_total: 0, by_type: {}, by_severity: {}, by_status: {} }),
    liabilityMonitor: async () => ({ open_count: 0, by_severity: {}, recent: [] }),
    recentActive: async () => []
  }
  const riskViewService = new RiskViewService({ metrics: riskMetricsReader })
  // BACKOFFICE-30/-42 — risk-signal list + triage surface.
  const riskSignalService = new RiskSignalService({ store: deps.riskSignalStore ?? new InMemoryRiskSignalStore(), audit: highClassAudit })
  // BACKOFFICE-49 — column-level lineage read surface (compliance:reports:read).
  const lineageService = new LineageService({ reader: deps.lineageReader ?? new InMemoryLineageReader(), audit: highClassAudit })
  // BACKOFFICE-36 — proactive Nebras-liability monitor read view (matrix + approaching triggers).
  // BACKOFFICE-65 — fold the 24h predictive liability forecast (regulated AI artefact) into it.
  const liabilityViewService = new LiabilityViewService({
    riskMetrics: riskMetricsReader,
    forecast: new LiabilityForecastService({ telemetry: new DemoLiabilityTelemetrySource() })
  })
  // BACKOFFICE-27 — Executive Dashboard: one canonical dashboard, persona-aware angles.
  // Commercial (commercial:read) = revenue/margin/pipeline; Programme (programme:read) =
  // adoption/certification. Margin is the non-asserting compute (the dashboard's own
  // scope gate governs access). Composes existing readers only — no new substrate.
  const executiveDashboardService = new ExecutiveDashboardService({
    consents: complianceMetrics,
    margin: { marginForPeriod: (period) => reconciliationService.computeMarginForPeriod(period) },
    pipeline: pipelineReader,
    certifications: certificationReader,
    recon: {
      latestRun: async () => {
        const { rows } = await reconciliationLogStore.list({ limit: 1 })
        const r = rows[0]
        return r ? { line_count_total: r.line_count_total ?? 0, line_count_matched: r.line_count_matched ?? 0 } : null
      }
    },
    handover: onboardingHandover,
    programme: new ProgrammeReportService() // BACKOFFICE-39
  })
  // BACKOFFICE-34 — onboarding funnel metrics (cycle time, handover count, stage
  // abandonment, cross-sell conversion, entry-path mix) over the P8 onboarding cases.
  const onboardingFunnelService = new OnboardingFunnelService({
    cases: deps.onboardingCaseReader ?? getAdapter('p8-onboarding-handover', profileFromConfig(process.env))
  })
  // BACKOFFICE-35 — self-service periodic report generation (templates + four-eyes
  // for CBUAE-bound reports via the approvals primitive, registered above).
  const reportGenerationService = new ReportGenerationService({ store: reportStore, approvals, audit: highClassAudit })
  // BACKOFFICE-67 — manual cadence ingest of the 16 login-only Nebras LFI reports
  // (compliance:reports:read dashboard + compliance:reports:generate verified upload).
  const lfiReportService = new LfiReportService({ reports: reportStore, audit: highClassAudit })
  // BACKOFFICE-74 — Trust Framework participant administration (Operations-owned).
  const trustFrameworkService = new TrustFrameworkService({
    store: deps.trustFrameworkStore ?? new InMemoryTrustFrameworkParticipantStore(),
    audit: highClassAudit
  })
  // BACKOFFICE-79 — Nebras service-desk case tracking (Operations-owned).
  const serviceDeskService = new ServiceDeskService({
    store: deps.serviceDeskStore ?? new InMemoryServiceDeskCaseStore(),
    audit: highClassAudit
  })
  // BACKOFFICE-42 — audit-trail drill-down (audit:read); the drill-down access is logged.
  const auditEventsService = new AuditEventsService({ reader: deps.auditEventReader ?? new InMemoryAuditEventReader(), audit: highClassAudit })
  // BACKOFFICE-41 — analytics exports: delegate to the view services (each re-asserts
  // its own scope) so an export carries the live view data + per-view scope enforcement.
  const exportViewData: ViewDataSource = {
    async getViewData(view, principal, traceId) {
      const fetchers: Record<string, () => Promise<{ data: Record<string, unknown> }>> = {
        'executive-dashboard': () => executiveDashboardService.view(principal, traceId),
        'operations-console': () => operationsConsoleService.view(principal),
        'compliance-view': () => complianceViewService.view(principal, traceId),
        'risk-view': () => riskViewService.view(principal, traceId),
        'finance-view': () => financeViewService.view(principal),
        'onboarding-funnel': () => onboardingFunnelService.view(principal),
        'nebras-liability-monitor': () => liabilityViewService.view(principal)
      }
      const f = fetchers[view]
      return f ? (await f()).data : {}
    }
  }
  const analyticsExportService = new AnalyticsExportService({ views: exportViewData, audit: highClassAudit })
  // BACKOFFICE-09 — Reconciliation SLO dashboard (read-only) aggregates the existing
  // reconciliation_log + reconciliation_break stores. reconciliation:read.
  const reconciliationSloService = new ReconciliationSloService({
    breaks: reconciliationBreakStore,
    runs: reconciliationLogStore
  })
  const idempotencyStore = deps.idempotency ?? new IdempotencyCache()
  // Implemented routes dispatch here; everything else stays a contract-pending 501 stub.
  const handlers = {
    ...approvalRoutes(approvals, deps.idempotency),
    ...consentRoutes(consentSearch),
    ...consentRevokeRoutes(revokeService, idempotencyStore),
    ...careSurfaceRoutes(careSurfaceService, idempotencyStore),
    ...consentBulkRevokeRoutes(bulkRevokeService, idempotencyStore),
    ...consentFraudRevokeRoutes(fraudRevokeService, idempotencyStore),
    ...registerQueryPurposeRoutes(registerQueryPurposeService, idempotencyStore),
    ...consentAuditTrailRoutes(auditTrail),
    ...disputeRoutes(disputeService, idempotencyStore),
    ...callRecordingRoutes(callRecordingService),
    ...respondentDisputeRoutes(respondentDisputeService, idempotencyStore),
    ...fraudIncidentRoutes(fraudIncidentService, idempotencyStore),
    ...agentRoutes(agentRegistryService, idempotencyStore),
    ...schemeNotificationRoutes(schemeNotificationService, idempotencyStore),
    ...inquiryRoutes(inquiryService, idempotencyStore),
    ...reconciliationRoutes(reconciliationService, idempotencyStore),
    ...tppBillingRoutes(tppRegistryService, idempotencyStore),
    ...tppInvoicingRoutes(invoicingService, idempotencyStore),
    ...financeViewRoutes(financeViewService),
    ...operationsConsoleRoutes(operationsConsoleService),
    ...complianceViewRoutes(complianceViewService),
    ...riskViewRoutes(riskViewService),
    ...riskSignalRoutes(riskSignalService, idempotencyStore),
    ...lineageRoutes(lineageService),
    ...reconciliationSloRoutes(reconciliationSloService),
    ...liabilityMonitorRoutes(liabilityViewService),
    ...executiveDashboardRoutes(executiveDashboardService),
    ...onboardingFunnelRoutes(onboardingFunnelService),
    ...analyticsExportRoutes(analyticsExportService, idempotencyStore),
    ...reportRoutes(reportGenerationService, idempotencyStore),
    ...lfiReportRoutes(lfiReportService, idempotencyStore),
    ...trustFrameworkRoutes(trustFrameworkService, idempotencyStore),
    ...serviceDeskRoutes(serviceDeskService, idempotencyStore),
    ...auditEventsRoutes(auditEventsService)
  }
  const app = new Hono()

  // outermost: every request — including 400/401/404 — is spanned (BACKOFFICE-48)
  app.use('*', createTelemetryMiddleware(apm))

  app.use('*', async (c, next) => {
    const fapi = c.req.header('x-fapi-interaction-id')
    if (!fapi) {
      return c.json(
        errorEnvelope(
          'BACKOFFICE.MISSING_FAPI_INTERACTION_ID',
          'The x-fapi-interaction-id header is required on every request.',
          'Send a UUID v4 in the x-fapi-interaction-id header; it is propagated end-to-end as the trace id.',
          DOCS_BASE
        ),
        400
      )
    }
    c.header('x-fapi-interaction-id', fapi)
    await next()
  })

  app.use(
    '*',
    createAuthMiddleware(idp, audit, {
      isServiceAccountSubject,
      onSuperAdminSession: (subject, tokenKey, traceId) => guardrails.onSession(subject, tokenKey, traceId),
      // ADR 0018 — the registry is the source of truth for agent liveness: a single-actor
      // revoke (BACKOFFICE-60) kills the session immediately, ahead of the short token TTL.
      isAgentActive: async (agentId) => (await agentStore.get(agentId))?.status === 'active'
    })
  )
  app.use('*', createScopeMiddleware(audit))
  app.use('*', createJustificationMiddleware(audit))
  // ADR 0018 / BACKOFFICE-53 — BFF-side re-assertion of agentic spend-control. Runs after
  // auth (needs the verified agent principal) + scope; no-ops for human sessions.
  app.use('*', createAgentSpendMiddleware({ ledger: new AgentSpendLedger(), riskSignals: riskSignalSink, itsm: itsmPort }))

  app.all('*', async (c) => {
    const url = new URL(c.req.url)
    const match = matchRoute(c.req.method, url.pathname)
    if (!match) {
      return c.json(
        errorEnvelope(
          'BACKOFFICE.ROUTE_NOT_FOUND',
          `${c.req.method} ${url.pathname} is not part of the Back Office contract.`,
          'Check the path against specs/backoffice-openapi.yaml — the contract is ground truth.',
          DOCS_BASE
        ),
        404
      )
    }
    // Service-layer scope check (defence in depth, BACKOFFICE-43): the stub stands in
    // for the story services, which must each call assertScope themselves.
    const required = ROUTES.find((r) => r.method === match.method && r.path === match.path)?.scope ?? null
    if (required !== null && !isDynamicScope(required)) {
      try {
        assertScope(c.get('principal'), required)
      } catch (e) {
        if (e instanceof ScopeDeniedError) return c.json(scopeDenialEnvelope(required), 403)
        throw e
      }
    }

    const handler = handlers[`${match.method} ${match.path}`]
    if (handler) return handler(c, match.params)

    return c.json(
      errorEnvelope(
        'BACKOFFICE.NOT_IMPLEMENTED',
        `${match.method.toUpperCase()} ${match.path} is specified but its story has not been implemented yet.`,
        'Implement the owning BACKOFFICE story (PRD §7); contract tests must be written first.',
        DOCS_BASE
      ),
      501
    )
  })

  return app
}
