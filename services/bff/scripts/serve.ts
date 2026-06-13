import { serve } from '@hono/node-server'
import { PgApprovalStore, PgAuditEmitter, PgIdempotencyStore, PgLineageEmitter, PgRiskSignalEmitter } from '@ofbo/db'
import { createApp } from '../src/app.js'

/**
 * Local dev server (node). With DATABASE_URL set, the BFF runs exactly like the
 * deployed worker: High-class audit to audit_high_sensitivity (PII redacted,
 * INSERT-only), durable approvals + Idempotency-Key replay in Postgres.
 * Without it, the in-memory defaults apply (single-process semantics).
 */
const port = Number(process.env.PORT ?? 8787)
const databaseUrl = process.env.DATABASE_URL

const tenancy = {
  bankId: process.env.BANK_ID ?? '11111111-1111-4111-8111-111111111111',
  channel: 'internal_retail'
}
const lineage = databaseUrl ? new PgLineageEmitter(databaseUrl, tenancy) : undefined
const audit = databaseUrl ? new PgAuditEmitter(databaseUrl, tenancy, lineage) : undefined
const approvalStore = databaseUrl ? new PgApprovalStore(databaseUrl, tenancy, lineage) : undefined
const idempotency = databaseUrl ? new PgIdempotencyStore(databaseUrl, tenancy) : undefined
const riskSignals = databaseUrl ? new PgRiskSignalEmitter(databaseUrl, tenancy, lineage) : undefined

const app = createApp({
  ...(audit ? { audit } : {}),
  ...(approvalStore ? { approvals: { store: approvalStore } } : {}),
  ...(idempotency ? { idempotency } : {}),
  ...(riskSignals ? { superadmin: { riskSignals } } : {})
})

serve({ fetch: app.fetch, port })
console.log(
  `OFBO BFF (demo profile) listening on http://localhost:${port} — stores: ${databaseUrl ? 'postgres (audit High-class, durable approvals + idempotency)' : 'in-memory'}`
)
