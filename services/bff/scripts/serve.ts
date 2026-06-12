import { serve } from '@hono/node-server'
import { PgAuditEmitter, PgLineageEmitter } from '@ofbo/db'
import { createApp } from '../src/app.js'

/**
 * Local dev server (node). With DATABASE_URL set, sign-in/scope audit events are
 * written to audit_high_sensitivity via the BACKOFFICE-45 emitter (PII redacted,
 * INSERT-only); without it, the in-memory sink applies.
 */
const port = Number(process.env.PORT ?? 8787)
const databaseUrl = process.env.DATABASE_URL

const tenancy = {
  bankId: process.env.BANK_ID ?? '11111111-1111-4111-8111-111111111111',
  channel: 'internal_retail'
}
const lineage = databaseUrl ? new PgLineageEmitter(databaseUrl, tenancy) : undefined
const audit = databaseUrl ? new PgAuditEmitter(databaseUrl, tenancy, lineage) : undefined

serve({ fetch: createApp(audit ? { audit } : {}).fetch, port })
console.log(
  `OFBO BFF (demo profile) listening on http://localhost:${port} — audit sink: ${audit ? 'postgres (High-class)' : 'in-memory'}`
)
