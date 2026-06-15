import {
  PgApprovalStore,
  PgAuditEmitter,
  PgComplianceReportStore,
  PgConsentEventReader,
  PgDisputeStore,
  PgIdempotencyStore,
  PgLineageEmitter,
  PgReconciliationBreakStore,
  PgReconciliationLogStore,
  PgRiskSignalEmitter
} from '@ofbo/db'
import { getAdapter, profileFromConfig } from '@ofbo/ports'
import { createApp } from './app.js'
import { ReconciliationService } from './reconciliation/service.js'

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

    const app = createApp({
      ...(audit ? { audit } : {}),
      ...(approvalStore ? { approvals: { store: approvalStore } } : {}),
      ...(idempotency ? { idempotency } : {}),
      ...(riskSignals ? { superadmin: { riskSignals } } : {}),
      ...(consentEvents ? { consentEventSource: consentEvents } : {}),
      ...(disputeStore ? { disputeStore } : {}),
      ...(complianceReportStore ? { complianceReportStore } : {}),
      ...(reconciliationLogStore ? { reconciliationLogStore } : {}),
      ...(reconciliationBreakStore ? { reconciliationBreakStore } : {})
    })
    try {
      return await app.fetch(request)
    } finally {
      for (const closable of [audit, lineage, approvalStore, idempotency, riskSignals, consentEvents, disputeStore, complianceReportStore, reconciliationLogStore, reconciliationBreakStore]) {
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
    const itsm = getAdapter('p3-itsm', profileFromConfig(env as Record<string, string | undefined>))
    const service = new ReconciliationService({ store, breakStore, itsm, audit })
    ctx.waitUntil(
      service
        .runDaily(crypto.randomUUID())
        .catch(() => undefined)
        .finally(async () => {
          await Promise.all([store.close(), breakStore.close(), audit.close(), lineage.close()])
        })
    )
  }
}
