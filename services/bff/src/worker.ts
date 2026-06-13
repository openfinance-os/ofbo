import { PgApprovalStore, PgAuditEmitter, PgIdempotencyStore, PgLineageEmitter, PgRiskSignalEmitter } from '@ofbo/db'
import { createApp } from './app.js'

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

    const app = createApp({
      ...(audit ? { audit } : {}),
      ...(approvalStore ? { approvals: { store: approvalStore } } : {}),
      ...(idempotency ? { idempotency } : {}),
      ...(riskSignals ? { superadmin: { riskSignals } } : {})
    })
    try {
      return await app.fetch(request)
    } finally {
      for (const closable of [audit, lineage, approvalStore, idempotency, riskSignals]) {
        if (closable) ctx.waitUntil(closable.close())
      }
    }
  }
}
