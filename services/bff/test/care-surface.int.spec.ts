import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgLineageEmitter } from '@ofbo/db'
import { CareSurfaceService } from '../src/care-surface/service.js'
import { mintScopes, type Principal } from '../src/auth.js'
import type { ConsentDirectory } from '../src/consents/directory.js'

/**
 * BACKOFFICE-25 integration: minting a care token writes exactly one High-class
 * care_token_minted audit under RLS — with the resolved internal sub and the raw
 * (possibly-PII) psu_identifier never persisted. Real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const CARE: Principal = { subject: 'demo:customer-care-agent', persona: 'customer-care-agent', scopes: mintScopes('customer-care-agent') }

const directory: ConsentDirectory = {
  search: (_t, id) => (id === 'known-psu' ? { psu: { bank_customer_id: 'cust-int-1', account_count: 1 }, consents: [] } : null),
  getByConsentId: () => null,
  psuByConsentId: () => null
}
const careSurface = {
  mintCareToken: async ({ agent_id, psu_id }: { agent_id: string; psu_id: string }) => ({
    token: 'tok',
    act: agent_id,
    sub: psu_id,
    expires_at: '2026-06-20T12:15:00.000Z'
  })
}

describe('care-surface mint-token — audited under RLS', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(url!)
  })
  afterAll(async () => {
    await audit.close()
    await lineage.close()
    await admin.end()
  })

  it('persists exactly one care_token_minted audit (resolved sub, no raw PII)', async () => {
    const svc = new CareSurfaceService({ careSurface, directory, audit })
    const trace = randomUUID()
    const token = await svc.mintToken(CARE, { identifier_type: 'emirates_id', psu_identifier: 'known-psu' }, trace)
    expect(token.sub).toBe('cust-int-1')

    const row = await admin.query(
      `SELECT acting_persona, scope_used, target_psu_identifier, request_body_redacted
         FROM audit_high_sensitivity
        WHERE request_trace_id = $1 AND event_type = 'care_token_minted'`,
      [trace]
    )
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0].acting_persona).toBe('customer-care-agent')
    expect(row.rows[0].scope_used).toBe('consents:admin')
    expect(row.rows[0].target_psu_identifier).toBe('cust-int-1') // resolved id, not the raw identifier
    expect(JSON.stringify(row.rows[0])).not.toContain('known-psu') // raw identifier never persisted
  })
})
