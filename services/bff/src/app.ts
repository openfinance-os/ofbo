import { Hono } from 'hono'
import { matchRoute, ROUTES } from '@ofbo/contracts'
import type { ApmPort, IdentityProviderPort, NebrasEgressPort } from '@ofbo/ports'
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
import { DemoConsentDirectory, type ConsentDirectory } from './consents/directory.js'
import {
  ConsentAuditTrailService,
  consentAuditTrailRoutes,
  InMemoryConsentEventSource,
  type ConsentEventSource
} from './consents/audit-trail.js'
import { ConsentRevokeService, consentRevokeRoutes } from './consents/revoke.js'
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
import { DisputeService, InMemoryDisputeStore, makeRefundOperation, REFUND_OPERATION, type DisputeStore } from './disputes/service.js'
import { disputeRoutes } from './disputes/routes.js'
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
  type ReconciliationLogStore,
  type ReconciliationBreakStore
} from './reconciliation/service.js'
import { reconciliationRoutes } from './reconciliation/routes.js'
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
  'get /consents:search-psu',
  'post /consents/{consent_id}:revoke-admin',
  'post /consents:revoke-bulk',
  'post /consents/{consent_id}:revoke-fraud',
  'get /consents/{consent_id}/audit-trail',
  'get /psu/{psu_identifier}/audit-trail',
  'get /payments/{payment_id}:admin',
  'post /disputes',
  'get /disputes',
  'post /disputes/{dispute_id}:initiate-refund',
  'post /back-office/inquiries/psu',
  'get /back-office/reconciliation/runs',
  'get /back-office/reconciliation/runs/{run_id}',
  'get /back-office/reconciliation/breaks',
  'get /back-office/reconciliation/breaks/{break_id}',
  'post /back-office/reconciliation/breaks/{break_id}/claim',
  'post /back-office/reconciliation/breaks/{break_id}/resolve',
  'post /back-office/reconciliation/breaks/{break_id}/reopen',
  'post /back-office/reconciliation/breaks/{break_id}/escalate-nebras'
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
}

/** Built once per isolate, not per request — the deterministic demo dataset is
 *  immutable, so a Worker that handles many requests pays the (tiny) build once. */
let demoConsentDirectory: ConsentDirectory | undefined
function sharedDemoConsentDirectory(): ConsentDirectory {
  return (demoConsentDirectory ??= new DemoConsentDirectory())
}

let demoPaymentDirectory: PaymentSource | undefined
function sharedDemoPaymentDirectory(): PaymentSource {
  return (demoPaymentDirectory ??= new DemoPaymentDirectory())
}

export function createApp(deps: AppDeps = {}) {
  const idp = deps.idp ?? getAdapter('p2-identity-provider', profileFromConfig(process.env))
  const audit = deps.audit ?? new InMemoryAuthAuditSink()
  const guardrails = new SuperAdminGuardrails({
    itsm: deps.superadmin?.itsm ?? getAdapter('p3-itsm', profileFromConfig(process.env)),
    riskSignals: deps.superadmin?.riskSignals ?? new InMemoryRiskSignalSink(),
    ...(deps.superadmin?.sessionTtlMs !== undefined ? { sessionTtlMs: deps.superadmin.sessionTtlMs } : {})
  })
  // High-class audit for story services: prefer an explicit sink, else reuse the
  // auth audit when it exposes emit (PgAuditEmitter does), else in-memory.
  const highClassAudit: HighClassAuditSink =
    deps.highClassAudit ?? (hasHighClassEmit(audit) ? audit : new InMemoryHighClassAuditSink())
  const consentDirectory = deps.consentDirectory ?? sharedDemoConsentDirectory()
  const consentSearch = new ConsentSearchService({
    audit: highClassAudit,
    directory: consentDirectory
  })
  const auditTrail = new ConsentAuditTrailService(deps.consentEventSource ?? new InMemoryConsentEventSource())
  const nebrasEgress = deps.nebrasEgress ?? getAdapter('p6-nebras-egress', profileFromConfig(process.env))
  const revokeService = new ConsentRevokeService({ egress: nebrasEgress, audit: highClassAudit })

  // Stores that four-eyes operations close over are built before the approvals
  // service so the operations can be registered: the refund op needs the dispute
  // store, the reopen op (BACKOFFICE-04) needs the reconciliation break store.
  const disputeStore = deps.disputeStore ?? new InMemoryDisputeStore()
  const reconciliationBreakStore = deps.reconciliationBreakStore ?? new InMemoryReconciliationBreakStore()
  const refundOperation = makeRefundOperation({ store: disputeStore, egress: nebrasEgress, audit: highClassAudit })
  const fraudRevokeOperation = makeFraudRevokeOperation({ egress: nebrasEgress, audit: highClassAudit })
  const bulkRevokeOperation = makeBulkRevokeOperation({ directory: consentDirectory, egress: nebrasEgress, audit: highClassAudit })
  const breakReopenOperation = makeBreakReopenOperation({ breakStore: reconciliationBreakStore, audit: highClassAudit })
  const approvals = new ApprovalsService(audit, {
    ...deps.approvals,
    operations: {
      ...deps.approvals?.operations,
      [REFUND_OPERATION]: refundOperation,
      [FRAUD_REVOKE_OPERATION]: fraudRevokeOperation,
      [BULK_REVOKE_OPERATION]: bulkRevokeOperation,
      [BREAK_REOPEN_OPERATION]: breakReopenOperation
    }
  })
  const fraudRevokeService = new ConsentFraudRevokeService(approvals)
  const bulkRevokeService = new ConsentBulkRevokeService(approvals, consentDirectory)
  const paymentSource = deps.paymentSource ?? sharedDemoPaymentDirectory()
  const disputeService = new DisputeService({
    store: disputeStore,
    payments: paymentSource,
    egress: nebrasEgress,
    audit: highClassAudit,
    approvals
  })
  const inquiryService = new InquiryBundleService({
    consents: consentDirectory,
    payments: paymentSource,
    disputes: disputeStore,
    events: deps.consentEventSource ?? new InMemoryConsentEventSource(),
    reports: deps.complianceReportStore ?? new InMemoryComplianceReportStore(),
    audit: highClassAudit
  })
  const apm = deps.apm ?? getAdapter('p5-apm', profileFromConfig(process.env))
  const reconciliationService = new ReconciliationService({
    store: deps.reconciliationLogStore ?? new InMemoryReconciliationLogStore(),
    breakStore: reconciliationBreakStore,
    itsm: deps.superadmin?.itsm ?? getAdapter('p3-itsm', profileFromConfig(process.env)),
    approvals,
    egress: nebrasEgress,
    apm,
    audit: highClassAudit
  })
  const idempotencyStore = deps.idempotency ?? new IdempotencyCache()
  // Implemented routes dispatch here; everything else stays a contract-pending 501 stub.
  const handlers = {
    ...approvalRoutes(approvals, deps.idempotency),
    ...consentRoutes(consentSearch),
    ...consentRevokeRoutes(revokeService, idempotencyStore),
    ...consentBulkRevokeRoutes(bulkRevokeService, idempotencyStore),
    ...consentFraudRevokeRoutes(fraudRevokeService, idempotencyStore),
    ...consentAuditTrailRoutes(auditTrail),
    ...disputeRoutes(disputeService, idempotencyStore),
    ...inquiryRoutes(inquiryService, idempotencyStore),
    ...reconciliationRoutes(reconciliationService, idempotencyStore)
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
      onSuperAdminSession: (subject, tokenKey, traceId) => guardrails.onSession(subject, tokenKey, traceId)
    })
  )
  app.use('*', createScopeMiddleware(audit))
  app.use('*', createJustificationMiddleware(audit))

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
