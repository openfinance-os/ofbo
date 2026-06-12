import { PgAuditEmitter, PgLineageEmitter } from '@ofbo/db'
import { createApp } from './app.js'

/**
 * Cloudflare Workers entry (demo profile, BD-14). The node entry stays in
 * scripts/serve.ts — this file only adapts the same createApp to the Workers
 * runtime. Emitters are constructed per request and closed after the response:
 * Workers forbid reusing I/O objects (pg sockets) across requests, and demo
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
    const lineage = env.DATABASE_URL ? new PgLineageEmitter(env.DATABASE_URL, tenancy) : undefined
    const audit = env.DATABASE_URL ? new PgAuditEmitter(env.DATABASE_URL, tenancy, lineage) : undefined

    const app = createApp(audit ? { audit } : {})
    try {
      return await app.fetch(request)
    } finally {
      if (audit) ctx.waitUntil(audit.close())
      if (lineage) ctx.waitUntil(lineage.close())
    }
  }
}
