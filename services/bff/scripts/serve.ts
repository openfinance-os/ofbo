import { serve } from '@hono/node-server'
import {
  PgApprovalStore,
  PgAuditEmitter,
  PgAuditReader,
  PgComplianceReportStore,
  PgConsentEventReader,
  PgDisputeStore,
  PgRespondentDisputeStore,
  PgFraudIncidentStore,
  PgSchemeNotificationStore,
  PgTrustFrameworkParticipantStore,
  PgServiceDeskCaseStore,
  PgIdempotencyStore,
  PgLineageEmitter,
  PgLineageReader,
  PgReconciliationBreakStore,
  PgReconciliationLogStore,
  PgReconciliationThresholdStore,
  PgRiskSignalEmitter,
  PgTppCounterpartyStore,
  PgBillingRecordStore,
  PgInvoiceRunStore,
  PgNebrasSnapshotStore,
  PgNebrasAggregateStore,
  PgCertificationStore,
  PgOutageStore,
  PgComplianceMetricsStore,
  PgRiskMetricsStore,
  retentionStatus
} from '@ofbo/db'
import { createApp } from '../src/app.js'

/**
 * Local dev server (node). With DATABASE_URL set, the BFF wires the SAME durable Pg
 * stores as the deployed worker (worker.ts) — so every console (Reconciliation, Analytics,
 * Risk, Operations, TPP Billing, Compliance) shows real data locally, not empty defaults.
 * Without DATABASE_URL the in-memory defaults apply (single-process semantics).
 */
const port = Number(process.env.PORT ?? 8787)
const url = process.env.DATABASE_URL

const tenancy = {
  bankId: process.env.BANK_ID ?? '11111111-1111-4111-8111-111111111111',
  channel: 'internal_retail'
}

const lineage = url ? new PgLineageEmitter(url, tenancy) : undefined
const audit = url ? new PgAuditEmitter(url, tenancy, lineage) : undefined
const approvalStore = url ? new PgApprovalStore(url, tenancy, lineage) : undefined
const idempotency = url ? new PgIdempotencyStore(url, tenancy) : undefined
const riskSignals = url ? new PgRiskSignalEmitter(url, tenancy, lineage) : undefined
const consentEvents = url ? new PgConsentEventReader(url, tenancy) : undefined
const disputeStore = url ? new PgDisputeStore(url, tenancy, lineage) : undefined
const respondentDisputeStore = url ? new PgRespondentDisputeStore(url, tenancy, lineage) : undefined
const fraudIncidentStore = url ? new PgFraudIncidentStore(url, tenancy, lineage) : undefined
const schemeNotificationStore = url ? new PgSchemeNotificationStore(url, tenancy, lineage) : undefined
const trustFrameworkStore = url ? new PgTrustFrameworkParticipantStore(url, tenancy, lineage) : undefined
const serviceDeskStore = url ? new PgServiceDeskCaseStore(url, tenancy, lineage) : undefined
const complianceReportStore = url ? new PgComplianceReportStore(url, tenancy, lineage) : undefined
const reconciliationLogStore = url ? new PgReconciliationLogStore(url, tenancy, lineage) : undefined
const reconciliationBreakStore = url ? new PgReconciliationBreakStore(url, tenancy, lineage) : undefined
const reconciliationThresholdStore = url ? new PgReconciliationThresholdStore(url, tenancy, lineage) : undefined
const tppCounterpartyStore = url ? new PgTppCounterpartyStore(url, tenancy, lineage) : undefined
const billingRecordStore = url ? new PgBillingRecordStore(url, tenancy, lineage) : undefined
const invoiceRunStore = url ? new PgInvoiceRunStore(url, tenancy, lineage) : undefined
const nebrasAggregateStore = url ? new PgNebrasAggregateStore(url, tenancy, lineage) : undefined
const nebrasSnapshotStore = url ? new PgNebrasSnapshotStore(url, tenancy, lineage) : undefined
const certificationStore = url ? new PgCertificationStore(url, tenancy) : undefined
const outageStore = url ? new PgOutageStore(url, tenancy) : undefined
// Pass the audit sink so the cross-fintech aggregate reads take the GOVERNED path (BACKOFFICE-33),
// matching worker.ts — without it the local dev server silently falls back to single-tenant reads.
const complianceMetricsStore = url && audit ? new PgComplianceMetricsStore(url, tenancy, audit) : undefined
const riskMetricsStore = url && audit ? new PgRiskMetricsStore(url, tenancy, audit) : undefined
const lineageReaderStore = url ? new PgLineageReader(url, tenancy) : undefined
const auditReader = url ? new PgAuditReader(url, tenancy) : undefined

const app = createApp({
  ...(audit ? { audit } : {}),
  ...(approvalStore ? { approvals: { store: approvalStore } } : {}),
  ...(idempotency ? { idempotency } : {}),
  ...(riskSignals ? { superadmin: { riskSignals } } : {}),
  ...(consentEvents ? { consentEventSource: consentEvents } : {}),
  ...(disputeStore ? { disputeStore } : {}),
  ...(respondentDisputeStore ? { respondentDisputeStore } : {}),
  ...(fraudIncidentStore ? { fraudIncidentStore } : {}),
  ...(schemeNotificationStore ? { schemeNotificationStore } : {}),
  ...(trustFrameworkStore ? { trustFrameworkStore } : {}),
  ...(serviceDeskStore ? { serviceDeskStore } : {}),
  ...(complianceReportStore ? { complianceReportStore, reportStore: complianceReportStore } : {}),
  ...(reconciliationLogStore ? { reconciliationLogStore } : {}),
  ...(reconciliationBreakStore ? { reconciliationBreakStore } : {}),
  ...(reconciliationThresholdStore ? { reconciliationThresholdStore } : {}),
  ...(tppCounterpartyStore ? { tppCounterpartyStore } : {}),
  ...(billingRecordStore ? { billingRecordStore } : {}),
  ...(invoiceRunStore ? { invoiceRunStore } : {}),
  ...(nebrasAggregateStore ? { nebrasAggregateReader: nebrasAggregateStore } : {}),
  ...(nebrasSnapshotStore ? { nebrasConnectivityReader: nebrasSnapshotStore } : {}),
  ...(certificationStore ? { certificationReader: certificationStore } : {}),
  ...(outageStore ? { outageReader: outageStore } : {}),
  ...(complianceMetricsStore ? { complianceMetricsReader: complianceMetricsStore } : {}),
  ...(riskMetricsStore ? { riskMetricsReader: riskMetricsStore, riskSignalStore: riskMetricsStore } : {}),
  ...(lineageReaderStore ? { lineageReader: lineageReaderStore } : {}),
  ...(auditReader ? { auditEventReader: auditReader } : {}),
  ...(url ? { retentionReader: { retentionStatus: () => retentionStatus(url) } } : {})
})

serve({ fetch: app.fetch, port })
console.log(
  `OFBO BFF (demo profile) listening on http://localhost:${port} — stores: ${url ? 'postgres (full store set, parity with the deployed worker)' : 'in-memory'}`
)
