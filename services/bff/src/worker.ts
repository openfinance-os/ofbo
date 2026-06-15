import {
  PgApprovalStore,
  PgAuditEmitter,
  PgAuditReader,
  PgComplianceReportStore,
  PgConsentEventReader,
  PgDisputeStore,
  PgIdempotencyStore,
  PgLineageEmitter,
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
  PgAnomalyDetectionStore,
  retentionStatus
} from '@ofbo/db'
import { getAdapter, profileFromConfig } from '@ofbo/ports'
import { createApp } from './app.js'
import { ReconciliationService } from './reconciliation/service.js'
import { NebrasIngestionService, InMemoryWarmTierExporter } from './analytics/ingestion.js'
import { LiabilityMonitorService, DemoLiabilityEventSource } from './risk/liability.js'
import { ConsentAnomalyDetector } from './risk/consent-anomaly.js'

/**
 * Cloudflare Workers entry (demo profile, BD-14). The node entry stays in
 * scripts/serve.ts — this file only adapts the same createApp to the Workers
 * runtime. All contract-bearing state (approvals, Idempotency-Key replay,
 * audit) lives in Postgres: Workers isolates recycle and multiply, so
 * in-memory state would break approval retrievability and the 24h replay
 * window. Pg clients are constructed per request and closed after the
 * response — Workers forbid reusing I/O objects across requests, and demo
 * traffic is far below the level where per-request pools would matter.
 * Requires the nodejs_compat flag (pg over cloudflare:sockets).
 */

interface WorkerEnv {
  DATABASE_URL?: string
  BANK_ID?: string
  DEPLOY_PROFILE?: string
}

interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: WorkerContext): Promise<Response> {
    const tenancy = {
      bankId: env.BANK_ID ?? '11111111-1111-4111-8111-111111111111',
      channel: 'internal_retail'
    }
    const url = env.DATABASE_URL
    const lineage = url ? new PgLineageEmitter(url, tenancy) : undefined
    const audit = url ? new PgAuditEmitter(url, tenancy, lineage) : undefined
    const approvalStore = url ? new PgApprovalStore(url, tenancy, lineage) : undefined
    const idempotency = url ? new PgIdempotencyStore(url, tenancy) : undefined
    const riskSignals = url ? new PgRiskSignalEmitter(url, tenancy, lineage) : undefined
    const consentEvents = url ? new PgConsentEventReader(url, tenancy) : undefined
    const disputeStore = url ? new PgDisputeStore(url, tenancy, lineage) : undefined
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
    const complianceMetricsStore = url ? new PgComplianceMetricsStore(url, tenancy) : undefined
    const riskMetricsStore = url ? new PgRiskMetricsStore(url, tenancy) : undefined
    const auditReader = url ? new PgAuditReader(url, tenancy) : undefined

    const app = createApp({
      ...(audit ? { audit } : {}),
      ...(approvalStore ? { approvals: { store: approvalStore } } : {}),
      ...(idempotency ? { idempotency } : {}),
      ...(riskSignals ? { superadmin: { riskSignals } } : {}),
      ...(consentEvents ? { consentEventSource: consentEvents } : {}),
      ...(disputeStore ? { disputeStore } : {}),
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
      ...(riskMetricsStore ? { riskMetricsReader: riskMetricsStore } : {}),
      ...(auditReader ? { auditEventReader: auditReader } : {}),
      ...(url ? { retentionReader: { retentionStatus: () => retentionStatus(url) } } : {})
    })
    try {
      return await app.fetch(request)
    } finally {
      for (const closable of [audit, lineage, approvalStore, idempotency, riskSignals, consentEvents, disputeStore, complianceReportStore, reconciliationLogStore, reconciliationBreakStore, tppCounterpartyStore, billingRecordStore, invoiceRunStore, nebrasAggregateStore, nebrasSnapshotStore, certificationStore, outageStore, complianceMetricsStore, riskMetricsStore, auditReader]) {
        if (closable) ctx.waitUntil(closable.close())
      }
    }
  },

  /**
   * BACKOFFICE-01 — the daily three-way reconciliation is a headless scheduled
   * job (no public ingress). Cron-triggered; run_id is derived from the date so
   * a retried/overlapping trigger is idempotent (the store ON CONFLICT no-ops).
   */
  async scheduled(_event: unknown, env: WorkerEnv, ctx: WorkerContext): Promise<void> {
    const url = env.DATABASE_URL
    if (!url) return
    const tenancy = { bankId: env.BANK_ID ?? '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
    const lineage = new PgLineageEmitter(url, tenancy)
    const audit = new PgAuditEmitter(url, tenancy, lineage)
    const store = new PgReconciliationLogStore(url, tenancy, lineage)
    const breakStore = new PgReconciliationBreakStore(url, tenancy, lineage)
    const snapshotStore = new PgNebrasSnapshotStore(url, tenancy, lineage)
    const aggregateStore = new PgNebrasAggregateStore(url, tenancy, lineage)
    const profile = profileFromConfig(env as Record<string, string | undefined>)
    const itsm = getAdapter('p3-itsm', profile)
    const apm = getAdapter('p5-apm', profile)
    const egress = getAdapter('p6-nebras-egress', profile)
    const service = new ReconciliationService({ store, breakStore, itsm, apm, audit })
    // BACKOFFICE-32: the daily ingestion polls the current month's Nebras
    // surfaces via P6 and refreshes the materialized aggregates the M4 views read.
    const period = new Date().toISOString().slice(0, 7)
    const ingestion = new NebrasIngestionService({ egress, snapshots: snapshotStore, aggregates: aggregateStore, audit, apm, warmExporter: new InMemoryWarmTierExporter() })
    // BACKOFFICE-36 — proactive Nebras-liability monitor: evaluate liability events
    // against the v2.1 matrix; emit nebras_liability_approach signals + P3 ITSM,
    // deduped against the currently-open liability signals.
    const riskSignals = new PgRiskSignalEmitter(url, tenancy, lineage)
    const riskMetrics = new PgRiskMetricsStore(url, tenancy)
    const liabilityMonitor = new LiabilityMonitorService({ signals: riskSignals, itsm })
    const runLiability = async () => {
      const open = await riskMetrics.liabilityMonitor()
      const openRefs = new Set(open.recent.map((s) => s.nebras_liability_event_ref).filter((r): r is string => !!r))
      const events = await new DemoLiabilityEventSource().getLiabilityEvents()
      await liabilityMonitor.evaluate(events, openRefs, crypto.randomUUID())
    }
    // BACKOFFICE-37 — streaming consent-pattern anomaly detection (windowed scan).
    // BACKOFFICE-46 — anomaly ITSM escalation (team-routed + critical paging) via P3.
    const anomalyStore = new PgAnomalyDetectionStore(url, tenancy)
    const anomalyDetector = new ConsentAnomalyDetector({ detection: anomalyStore, signals: riskSignals, itsm })
    ctx.waitUntil(
      Promise.allSettled([
        service.runDaily(crypto.randomUUID()),
        ingestion.runIngestion(period, crypto.randomUUID()),
        runLiability(),
        anomalyDetector.detect(crypto.randomUUID())
      ]).finally(async () => {
        await Promise.all([store.close(), breakStore.close(), snapshotStore.close(), aggregateStore.close(), riskSignals.close(), riskMetrics.close(), anomalyStore.close(), audit.close(), lineage.close()])
      })
    )
  }
}
