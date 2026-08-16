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
  PgStrDraftStore,
  PgIdempotencyStore,
  PgLineageEmitter,
  PgLineageReader,
  PgReconciliationBreakStore,
  PgReconciliationLogStore,
  PgReconciliationThresholdStore,
  PgRiskSignalEmitter,
  PgTppCounterpartyStore,
  PgBillingRecordStore,
  PgBillingRateCardStore,
  PgBillingMemoStore,
  PgBillingCollectionsStore,
  PgBillingAccountingStore,
  PgBillingRevenueAssuranceStore,
  PgBillingProfitabilityStore,
  PgTenantBillingServiceStore,
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
import { getAdapter, profileFromConfig, type IdentityProviderPort } from '@ofbo/ports'
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
import { fils, SCHEME_RATE_CARD_2026_06_02, type RateCard } from '@ofbo/billing'
import {
  BILLING_RATE_CARD_SOURCES,
  BILLING_RATE_CARD_WATCH_CRON,
  runBillingRateCardWatch
} from './billing/rate-card-watch.js'
import { BillingMemoReconciliationService } from './billing/memo-reconciliation.js'
import { isExpectedMemoGenerationDay, previousUtcMonth } from './billing/pg-memo-reconciliation.js'
import { RevenueAssuranceService } from './billing/revenue-assurance.js'
import { BillingProfitabilityService } from './billing/profitability.js'
import { BillingTenantService } from './billing/tenant-service.js'

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
  /** HOST-01 (ADR 0028) — enables verified P2 tenant claims for the shared demo. OFF by default:
   *  single-tenant deployments remain pinned to BANK_ID. */
  MULTITENANT_DEMO?: string
}

const DEFAULT_BANK_ID = '11111111-1111-4111-8111-111111111111'

/**
 * Resolve the store tenancy only from an IdP-verified bearer claim. Invalid/unscoped credentials
 * bind to the deployment fallback solely so the normal auth middleware can emit its 401 audit;
 * they never select another tenant. No request header is an authority boundary.
 */
async function resolveRequestBankId(request: Request, env: WorkerEnv, idp: IdentityProviderPort): Promise<string> {
  const fallback = env.BANK_ID ?? DEFAULT_BANK_ID
  if (env.MULTITENANT_DEMO !== 'true') return fallback
  const bearer = request.headers.get('authorization')
  if (!bearer?.startsWith('Bearer ')) return fallback
  const token = bearer.slice('Bearer '.length)
  try {
    const agent = await idp.verifyAgentSession(token)
    if (agent) return agent.bank_id ?? fallback
    const claims = await idp.verifyToken(token)
    return claims.mfa ? claims.bank_id ?? fallback : fallback
  } catch {
    return fallback
  }
}

interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void
}

/** Cloudflare cron event — scheduledTime makes a retried billing projection deterministic. */
interface ScheduledEvent {
  cron: string
  scheduledTime?: number
}

/**
 * DEMO-01 — the daily three-way reconciliation runs at 01:00 UTC. Every OTHER cron tick is a
 * lightweight demo-warmth ping (see scheduled()): it keeps the Supabase free-tier DB from
 * auto-pausing and the Hyperdrive pool warm, so a presenter's first click never lands on a
 * cold connect. Must match the [triggers] crons entry in wrangler.toml exactly.
 */
const DAILY_RECON_CRON = '0 1 * * *'

async function configuredBillingProfiles(url: string, env: WorkerEnv): Promise<Array<{ bankId: string; rateCard: RateCard }>> {
  const fallbackBankId = env.BANK_ID ?? DEFAULT_BANK_ID
  const store = new PgTenantBillingServiceStore(url)
  try {
    const bankIds = env.MULTITENANT_DEMO === 'true' ? await store.activeTenantBankIds() : [fallbackBankId]
    if (bankIds.length === 0) return [{ bankId: fallbackBankId, rateCard: SCHEME_RATE_CARD_2026_06_02 }]
    const tenantService = new BillingTenantService({ configurations: store })
    return Promise.all(bankIds.map(async (bankId) => {
      const configuration = await store.configuration(bankId)
      if (!configuration) {
        if (env.MULTITENANT_DEMO === 'true') throw new Error(`active billing tenant ${bankId} has no configuration`)
        return { bankId, rateCard: SCHEME_RATE_CARD_2026_06_02 }
      }
      const profile = await tenantService.profile(bankId, SCHEME_RATE_CARD_2026_06_02)
      return { bankId, rateCard: profile.rateCard }
    }))
  } finally {
    await store.close()
  }
}

/** BILL-10: run the monthly projection independently inside each tenant's RLS context. */
async function runTenantBillingProjection(
  url: string,
  bankId: string,
  rateCard: RateCard,
  billingRunAt: Date
): Promise<void> {
  const tenancy = { bankId, channel: 'internal_retail' }
  const lineage = new PgLineageEmitter(url, tenancy)
  const audit = new PgAuditEmitter(url, tenancy, lineage)
  const reconciliationStore = new PgReconciliationLogStore(url, tenancy, lineage)
  const breakStore = new PgReconciliationBreakStore(url, tenancy, lineage)
  const memoStore = new PgBillingMemoStore(url, tenancy, lineage)
  const assuranceStore = new PgBillingRevenueAssuranceStore(url, tenancy, lineage)
  const workflow = new ReconciliationService({ store: reconciliationStore, breakStore, audit })
  const memoService = new BillingMemoReconciliationService({ store: memoStore, workflow, audit })
  const assuranceService = new RevenueAssuranceService({ store: assuranceStore, evidence: assuranceStore, audit })
  const period = previousUtcMonth(billingRunAt)
  try {
    const jobs: Promise<unknown>[] = [assuranceService.generatePeriod({
      period,
      generatedAt: billingRunAt.toISOString(),
      rateCard,
      blindSpotValuationMilliFils: fils(2.5),
      freeTierExceptions: [],
      overageOpportunity: {
        publishedRateMilliFils: rateCard.receivable['data.retail_page'].overageMilliFils,
        valuationRateMilliFils: rateCard.receivable['data.retail_page'].overageMilliFils,
        valuationRef: rateCard.receivable['data.retail_page'].overageSource
      }
    }, crypto.randomUUID())]
    if (isExpectedMemoGenerationDay(billingRunAt)) {
      jobs.push(memoService.generateExpectedMemo(period, rateCard, billingRunAt.toISOString(), crypto.randomUUID()))
    }
    const results = await Promise.allSettled(jobs)
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failures.length > 0) throw new AggregateError(failures.map((failure) => failure.reason), `billing projection failed for ${bankId}`)
  } finally {
    await Promise.allSettled([
      reconciliationStore.close(), breakStore.close(), memoStore.close(), assuranceStore.close(), audit.close(), lineage.close()
    ])
  }
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: WorkerContext): Promise<Response> {
    // BACKOFFICE-59 — a TRAINING Worker short-circuits to the isolated, in-memory training
    // environment BEFORE any production store (DB, audit emitter, egress) is constructed, so a
    // training deployment shares nothing with production. Selected by deploy config, never per
    // request — there is no header that flips a production Worker into training.
    if (env.OFBO_TRAINING === 'true') {
      return await createApp({ training: true }).fetch(request)
    }
    const profile = profileFromConfig(env as Record<string, string | undefined>)
    const idp = getAdapter('p2-identity-provider', profile)
    const tenancy = {
      bankId: await resolveRequestBankId(request, env, idp),
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
    const strDraftStore = url ? new PgStrDraftStore(url, tenancy, lineage) : undefined
    const complianceReportStore = url ? new PgComplianceReportStore(url, tenancy, lineage) : undefined
    const reconciliationLogStore = url ? new PgReconciliationLogStore(url, tenancy, lineage) : undefined
    const reconciliationBreakStore = url ? new PgReconciliationBreakStore(url, tenancy, lineage) : undefined
    const reconciliationThresholdStore = url ? new PgReconciliationThresholdStore(url, tenancy, lineage) : undefined
    const tppCounterpartyStore = url ? new PgTppCounterpartyStore(url, tenancy, lineage) : undefined
    const billingRecordStore = url ? new PgBillingRecordStore(url, tenancy, lineage) : undefined
    const invoiceRunStore = url ? new PgInvoiceRunStore(url, tenancy, lineage) : undefined
    const billingCollectionsStore = url ? new PgBillingCollectionsStore(url, tenancy, lineage) : undefined
    const billingAccountingStore = url ? new PgBillingAccountingStore(url, tenancy, lineage) : undefined
    const billingRevenueAssuranceStore = url ? new PgBillingRevenueAssuranceStore(url, tenancy, lineage) : undefined
    const billingProfitabilityStore = url ? new PgBillingProfitabilityStore(url, tenancy) : undefined
    const tenantBillingStore = url ? new PgTenantBillingServiceStore(url) : undefined
    const tenantConfiguration = tenantBillingStore
      ? await tenantBillingStore.configuration(tenancy.bankId)
      : null
    const billingProfitabilityService = billingProfitabilityStore && audit
      ? new BillingProfitabilityService({ source: billingProfitabilityStore, audit })
      : undefined
    const billingTenantService = tenantBillingStore
      ? new BillingTenantService({ configurations: tenantBillingStore, data: tenantBillingStore })
      : undefined
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
      idp,
      ...(audit ? { audit } : {}),
      ...(approvalStore ? { approvals: {
        store: approvalStore,
        ...(tenantConfiguration ? { expiryBusinessHours: tenantConfiguration.approvalExpiryBusinessHours } : {})
      } } : {}),
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
      ...(strDraftStore ? { strDraftStore } : {}),
      ...(complianceReportStore ? { complianceReportStore, reportStore: complianceReportStore } : {}),
      ...(reconciliationLogStore ? { reconciliationLogStore } : {}),
      ...(reconciliationBreakStore ? { reconciliationBreakStore } : {}),
      ...(reconciliationThresholdStore ? { reconciliationThresholdStore } : {}),
      ...(tppCounterpartyStore ? { tppCounterpartyStore } : {}),
      ...(billingRecordStore ? { billingRecordStore } : {}),
      ...(invoiceRunStore ? { invoiceRunStore } : {}),
      ...(billingCollectionsStore ? { billingCollectionsStore } : {}),
      ...(billingAccountingStore ? { accountingClosePackReader: billingAccountingStore } : {}),
      ...(billingRevenueAssuranceStore ? { revenueAssuranceReader: billingRevenueAssuranceStore } : {}),
      ...(billingProfitabilityService ? { profitabilityReader: billingProfitabilityService } : {}),
      ...(billingProfitabilityService ? { billingProfitability: billingProfitabilityService } : {}),
      ...(billingTenantService ? { billingTenant: billingTenantService } : {}),
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
      for (const closable of [audit, lineage, approvalStore, idempotency, riskSignals, consentEvents, disputeStore, respondentDisputeStore, fraudIncidentStore, agentStore, schemeNotificationStore, trustFrameworkStore, serviceDeskStore, strDraftStore, complianceReportStore, reconciliationLogStore, reconciliationBreakStore, tppCounterpartyStore, billingRecordStore, invoiceRunStore, billingCollectionsStore, billingAccountingStore, billingRevenueAssuranceStore, billingProfitabilityStore, tenantBillingStore, nebrasAggregateStore, nebrasSnapshotStore, certificationStore, outageStore, complianceMetricsStore, riskMetricsStore, queryPurposeRegistrar, lineageReaderStore, auditReader, readinessProfileStore]) {
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
    const tenancy = { bankId: env.BANK_ID ?? '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
    if (event.cron === BILLING_RATE_CARD_WATCH_CRON) {
      const itsm = getAdapter('p3-itsm', profileFromConfig(env as Record<string, string | undefined>))
      const billingProfiles = await configuredBillingProfiles(url, env)
      ctx.waitUntil(Promise.allSettled(billingProfiles.map(({ bankId, rateCard }) => {
        const tenant = { bankId, channel: 'internal_retail' }
        const lineage = new PgLineageEmitter(url, tenant)
        return runBillingRateCardWatch({
          databaseUrl: url,
          tenancy: tenant,
          makeStore: (databaseUrl, config) => new PgBillingRateCardStore(databaseUrl, config, lineage),
          makeAudit: (databaseUrl, config) => new PgAuditEmitter(databaseUrl, config, lineage),
          itsm,
          sources: BILLING_RATE_CARD_SOURCES,
          rateCard
        }, crypto.randomUUID()).finally(() => lineage.close())
      })))
      return
    }
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
    const billingProfiles = await configuredBillingProfiles(url, env)
    const tenantBillingJobs = billingProfiles.map(({ bankId, rateCard }) =>
      runTenantBillingProjection(url, bankId, rateCard, new Date(event.scheduledTime ?? Date.now()))
    )
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
        ...tenantBillingJobs,
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
