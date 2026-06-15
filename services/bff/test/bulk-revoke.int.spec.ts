import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgLineageEmitter } from '@ofbo/db'
import { generateDemoDataset } from '@ofbo/synthetic-data'
import { makeBulkRevokeOperation } from '../src/consents/bulk-revoke.js'
import { DemoConsentDirectory } from '../src/consents/directory.js'

/**
 * BACKOFFICE-18 integration: the bulk-revoke operation's single grouped
 * High-class audit persists under RLS with every revocation id + revoked_count,
 * and emits BCBS 239 lineage for audit_high_sensitivity — against real Postgres.
 * (The four-eyes HTTP flow is covered by the unit suite.)
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const PSU = generateDemoDataset().psus[1]!
const ACTIVE = new Set(['Authorized', 'Suspended'])
const activeIds = PSU.consents.filter((c) => ACTIVE.has(c.status)).map((c) => c.consent_id).sort()

class FakeEgress {
  async revokeConsent() {
    return { acknowledged_in_ms: 410 }
  }
}

describe('bulk revoke — grouped audit persistence + lineage', () => {
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

  it('persists ONE grouped consents_bulk_revoked audit with all revocation ids + lineage', async () => {
    const trace = randomUUID()
    const op = makeBulkRevokeOperation({ directory: new DemoConsentDirectory(), egress: new FakeEgress(), audit })
    const result = (await op.execute({
      psu_identifier_type: 'bank_customer_id',
      psu_identifier: PSU.bank_customer_id,
      reason_code: 'CLIENT_INSTRUCTION',
      initiated_by: 'demo:customer-care-agent',
      initiated_by_persona: 'customer-care-agent',
      trace_id: trace
    })) as { status: string; revoked_count: number; consent_ids: string[]; psu_notified: boolean }
    expect(result.status).toBe('Revoked')
    expect(result.revoked_count).toBe(activeIds.length)
    expect(result.psu_notified).toBe(true)

    const { rows } = await admin.query(
      `SELECT scope_used, target_psu_identifier, request_body_redacted FROM audit_high_sensitivity
         WHERE request_trace_id = $1 AND event_type = 'consents_bulk_revoked'`,
      [trace]
    )
    expect(rows).toHaveLength(1) // grouped — one record for the whole sweep
    expect(rows[0].scope_used).toBe('consents:admin')
    expect(rows[0].target_psu_identifier).toBe(PSU.bank_customer_id)
    expect(rows[0].request_body_redacted.reason_code).toBe('CLIENT_INSTRUCTION')
    expect(rows[0].request_body_redacted.revoked_count).toBe(activeIds.length)
    expect((rows[0].request_body_redacted.consent_ids as string[]).slice().sort()).toEqual(activeIds)

    const lin = await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'audit_high_sensitivity'`, [trace])
    expect(lin.rows.length).toBeGreaterThan(0)
  })
})
