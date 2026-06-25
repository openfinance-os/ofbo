import {
  PgApprovalStore,
  PgReadinessProfileStore,
  PgAuditEmitter,
  PgAuditReader,
  PgComplianceReportStore,
  PgConsentEventReader,
  PgDisputeStore,
  PgRespondentDisputeStore,
  PgFraudIncidentStore,
  PgAgentStore,
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
  PgAnomalyDetectionStore,
  PgQueryPurposeRegistrar,
  retentionStatus
} from '@ofbo/db'
import { getAdapter, profileFromConfig } from '@ofbo/ports'
import pg from 'pg'
import { createApp } from './app.js'
import { ReconciliationService } from './reconciliation/service.js'
import { NebrasIngestionService, InMemoryWarmTierExporter } from './analytics/ingestion.js'
import { LiabilityMonitorService, DemoLiabilityEventSource } from './risk/liability.js'
import { LiabilityForecastMonitor, DemoLiabilityTelemetrySource } from './risk/liability-forecast.js'
import { ConsentAnomalyDetector } from './risk/consent-anomaly.js'
import { ConsentDriftMonitor, DemoConsentDriftSource } from './risk/consent-drift.js'
import { TppBehaviourProfiler, DemoTppActivitySource } from './risk/tpp-profiling.js'
import { CertExpiryMonitor, DemoCertChainSource } from './ops/cert-expiry.js'
import { LfiCadenceMonitor } from './lfi-reports/service.js'
import { CaapRegistrationRecorder, DemoCaapEventSource } from './risk/caap-audit.js'

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
  /** Cloudflare Hyperdrive binding — pools warm connections to Postgres at the edge so the
   *  Worker stops paying the cold connect + TLS handshake to Supabase on every request (the
   *  dominant cost of the ~12s/screen hosted latency). Preferred over DATABASE_URL when bound.
   *  Activate: `wrangler hyperdrive create ofbo-db --connection-string="$DATABASE_URL"` then
   *  paste the id into wrangler.toml's [[hyperdrive]] binding. */
  HYPERDRIVE?: { connectionString: string }
  BANK_ID?: string
  DEPLOY_PROFILE?: string
  /** BACKOFFICE-59 — set to 'true' on a dedicated TRAINING Worker instance (no DB binding).
   *  It serves the in-memory synthetic training environment: a separate dataset, a training-only
   *  audit sink, and a sandbox egress — so a trainee's action never reaches production data,
   *  the production audit trail, or the real scheme. */
  OFBO_TRAINING?: string
}

interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void
}

/** Cloudflare cron event — only `.cron` (the matched schedule string) is used here. */
interface ScheduledEvent {
  cron: string
}

/**
 * DEMO-01 — the daily three-way reconciliation runs at 01:00 UTC. Every OTHER cron tick is a
 * lightweight demo-warmth ping (see scheduled()): it keeps the Supabase free-tier DB from
 * auto-pausing and the Hyperdrive pool warm, so a presenter's first click never lands on a
 * cold connect. Must match the [triggers] crons entry in wrangler.toml exactly.
 */
const DAILY_RECON_CRON = '0 1 * * *'

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: WorkerContext): Promise<Response> {
    // BACKOFFICE-59 — a TRAINING Worker short-circuits to the isolated, in-memory training
    // environment BEFORE any production store (DB, audit emitter, egress) is constructed, so a
    // training deployment shares nothing with production. Selected by deploy config, never per
    // request — there is no header that flips a production Worker into training.
    if (env.OFBO_TRAINING === 'true') {
      return await createApp({ training: true }).fetch(request)
    }
    const tenancy = {
      bankId: env.BANK_ID ?? '11111111-1111-4111-8111-111111111111',
      channel: 'internal_retail'
    }
    const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL
    const lineage = url ? new PgLineageEmitter(url, tenancy) : undefined
    const audit = url ? new PgAuditEmitter(url, tenancy, lineage) : undefined
    const approvalStore = url ? new PgApprovalStore(url, tenancy, lineage) : undefined
    const idempotency = url ? new PgIdempotencyStore(url, tenancy) : undefined
    const riskSignals = url ? new PgRiskSignalEmitter(url, tenancy, lineage) : undefined
    const consentEvents = url ? new PgConsentEventReader(url, tenancy) : undefined
    const disputeStore = url ? new PgDisputeStore(url, tenancy, lineage) : undefined
    const respondentDisputeStore = url ? new PgRespondentDisputeStore(url, tenancy, lineage) : undefined
    const fraudIncidentStore = url ? new PgFraudIncidentStore(url, tenancy, lineage) : undefined
    const agentStore = url ? new PgAgentStore(url, tenancy, lineage) : undefined
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
    const complianceMetricsStore = url && audit ? new PgComplianceMetricsStore(url, tenancy, audit) : undefined
    const riskMetricsStore = url && audit ? new PgRiskMetricsStore(url, tenancy, audit) : undefined
    const queryPurposeRegistrar = url ? new PgQueryPurposeRegistrar(url, tenancy, lineage) : undefined
    const lineageReaderStore = url ? new PgLineageReader(url, tenancy) : undefined
    const auditReader = url ? new PgAuditReader(url, tenancy) : undefined
    // ADR 0022 — persist public readiness-wizard profiles (non-regulated, no PII)
    const readinessProfileStore = url ? new PgReadinessProfileStore(url, tenancy) : undefined

    const app = createApp({
      ...(audit ? { audit } : {}),
      ...(approvalStore ? { approvals: { store: approvalStore } } : {}),
      ...(idempotency ? { idempotency } : {}),
      ...(riskSignals ? { superadmin: { riskSignals } } : {}),
      ...(consentEvents ? { consentEventSource: consentEvents } : {}),
      ...(disputeStore ? { disputeStore } : {}),
      ...(respondentDisputeStore ? { respondentDisputeStore } : {}),
      ...(fraudIncidentStore ? { fraudIncidentStore } : {}),
      ...(agentStore ? { agentStore } : {}),
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
      ...(queryPurposeRegistrar ? { queryPurposeRegistrar } : {}),
      ...(lineageReaderStore ? { lineageReader: lineageReaderStore } : {}),
      ...(auditReader ? { auditEventReader: auditReader } : {}),
      ...(readinessProfileStore ? { readinessProfileStore } : {}),
      ...(url ? { retentionReader: { retentionStatus: () => retentionStatus(url) } } : {})
    })
    try {
      return await app.fetch(request)
    } finally {
      for (const closable of [audit, lineage, approvalStore, idempotency, riskSignals, consentEvents, disputeStore, respondentDisputeStore, fraudIncidentStore, agentStore, schemeNotificationStore, trustFrameworkStore, serviceDeskStore, complianceReportStore, reconciliationLogStore, reconciliationBreakStore, tppCounterpartyStore, billingRecordStore, invoiceRunStore, nebrasAggregateStore, nebrasSnapshotStore, certificationStore, outageStore, complianceMetricsStore, riskMetricsStore, queryPurposeRegistrar, lineageReaderStore, auditReader]) {
        if (closable) ctx.waitUntil(closable.close())
      }
    }
  },

  /**
   * BACKOFFICE-01 — the daily three-way reconciliation is a headless scheduled
   * job (no public ingress). Cron-triggered; run_id is derived from the date so
   * a retried/overlapping trigger is idempotent (the store ON CONFLICT no-ops).
   */
  async scheduled(event: ScheduledEvent, env: WorkerEnv, ctx: WorkerContext): Promise<void> {
    const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL
    if (!url) return
    // DEMO-01 — demo-warmth ping. Any cron OTHER than the daily reconciliation is the frequent
    // keep-warm tick: a single cheap round-trip through the same Hyperdrive/Pg path the request
    // handler uses, so the Supabase free-tier DB never auto-pauses and the pool stays warm. This
    // is what stops a presenter's first click from hitting a multi-second cold connect.
    if (event.cron !== DAILY_RECON_CRON) {
      const pool = new pg.Pool({ connectionString: url, max: 1 })
      try {
        await pool.query('SELECT 1')
      } finally {
        await pool.end()
      }
      return
    }
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
    // BACKOFFICE-38 — TPP behavioural profiling: 3σ deviations (volume / hour-of-day /
    // CoP mismatch) → tpp_behaviour Risk signal, deduped against open signals.
    const tppProfiler = new TppBehaviourProfiler({ source: new DemoTppActivitySource(), signals: riskSignals, dedup: anomalyStore })
    // DEMO-08 — consent-drift monitor: read each watched consent's Hub status via P6 and compare
    // to the platform mirror; a mismatch raises a consent_anomaly signal (deduped). Harmless when
    // no drift exists (0 signals); the simulator's consent_drift fault makes it fire on demand.
    const driftMonitor = new ConsentDriftMonitor({ egress, signals: riskSignals, source: new DemoConsentDriftSource(), dedup: anomalyStore })
    // BACKOFFICE-66 — scheme certificate expiry monitor: red ≤30d → P3 ITSM ticket,
    // critical ≤7d → ticket + High-class audit (chain handled by P6).
    const certMonitor = new CertExpiryMonitor({ source: new DemoCertChainSource(), itsm, audit })
    // BACKOFFICE-69 — record CAAP register/deregister events (High-class audit); the
    // anomaly detector above scans caap_registered for the >10/device/hour spike.
    const recordCaap = async () => new CaapRegistrationRecorder({ audit }).record(await new DemoCaapEventSource().getEvents(), crypto.randomUUID())
    // BACKOFFICE-67 — flag any login-only Nebras LFI report overdue against its cadence
    // (ITSM ticket + lfi_report_cadence_missed Risk signal).
    const lfiReports = new PgComplianceReportStore(url, tenancy, lineage)
    const lfiCadenceMonitor = new LfiCadenceMonitor({ reports: lfiReports, itsm, riskSignals })
    // BACKOFFICE-65 — predictive liability forecast (regulated AI artefact): raise a
    // predictive_liability_forecast signal per high-probability class (deduped vs open
    // liability refs); -36 threshold monitor remains the deterministic fallback.
    const forecastMonitor = new LiabilityForecastMonitor({ telemetry: new DemoLiabilityTelemetrySource(), signals: riskSignals, itsm })
    const runForecast = async () => {
      const open = await riskMetrics.liabilityMonitor()
      const openRefs = new Set(open.recent.map((s) => s.nebras_liability_event_ref).filter((r): r is string => !!r))
      await forecastMonitor.run(crypto.randomUUID(), openRefs)
    }
    ctx.waitUntil(
      Promise.allSettled([
        service.runDaily(crypto.randomUUID()),
        ingestion.runIngestion(period, crypto.randomUUID()),
        runLiability(),
        recordCaap().then(() => anomalyDetector.detect(crypto.randomUUID())),
        tppProfiler.profile(crypto.randomUUID()),
        driftMonitor.detect(crypto.randomUUID()),
        certMonitor.check(crypto.randomUUID()),
        lfiCadenceMonitor.check(crypto.randomUUID()),
        runForecast()
      ]).finally(async () => {
        await Promise.all([store.close(), breakStore.close(), snapshotStore.close(), aggregateStore.close(), riskSignals.close(), riskMetrics.close(), anomalyStore.close(), lfiReports.close(), audit.close(), lineage.close()])
      })
    )
  }
}
