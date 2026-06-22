import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations } from '../src/apply.js'
import { PgAuditEmitter } from '../src/audit.js'
import { beginAppTx } from '../src/tenant-tx.js'
import {
  GovernedQueryError,
  isPurposeApproved,
  runGovernedAggregate,
  seedQueryPurposes
} from '../src/governed-aggregate.js'

/**
 * BACKOFFICE-33 (ADR 0015) — the governed cross-fintech aggregation control, proven against
 * Postgres with the real roles/RLS/grants:
 *   • the BD-13 starter purposes seed as approved;
 *   • an approved purpose runs as bank_internal_view (cross-tenant) and writes a High-class
 *     `cross_fintech_query` audit row;
 *   • an unregistered purpose is REJECTED before any read (and nothing is logged);
 *   • a tenant-scoped role (ofbo_app) CANNOT read the cross-fintech MV at all.
 */

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('integration tests require DATABASE_URL')

const BANK = '11111111-1111-4111-8111-111111111111'
const CHANNEL = 'internal_retail'

const pool = new pg.Pool({ connectionString: DATABASE_URL })
const audit = new PgAuditEmitter(DATABASE_URL, { bankId: BANK, channel: CHANNEL })

/** Count cross_fintech_query audit rows for this bank (as ofbo_app, RLS-bound). */
async function countBypassLogs(): Promise<number> {
  const c = await pool.connect()
  try {
    await c.query(beginAppTx(BANK))
    const r = await c.query(`SELECT count(*)::int AS n FROM audit_high_sensitivity WHERE event_type = 'cross_fintech_query'`)
    await c.query('COMMIT')
    return r.rows[0].n as number
  } finally {
    c.release()
  }
}

function context(purposeCode: string) {
  return {
    pool,
    bankId: BANK,
    purposeCode,
    audit,
    actingPrincipal: 'demo:compliance-officer',
    actingPersona: 'compliance-officer',
    scopeUsed: 'compliance:reports:read',
    traceId: randomUUID()
  }
}

beforeAll(async () => {
  await applyMigrations(DATABASE_URL)
  await seedQueryPurposes(pool, BANK, CHANNEL)
})

afterAll(async () => {
  await pool.end()
  await audit.close?.()
})

describe('BACKOFFICE-33 governed cross-fintech aggregation', () => {
  it('seeds the BD-13 starter purposes as approved (and unknown purposes are not)', async () => {
    expect(await isPurposeApproved(pool, BANK, 'compliance_reporting')).toBe(true)
    expect(await isPurposeApproved(pool, BANK, 'risk_monitoring')).toBe(true)
    expect(await isPurposeApproved(pool, BANK, `never_registered_${randomUUID()}`)).toBe(false)
  })

  it('runs an approved purpose as bank_internal_view (cross-tenant) and High-class logs the bypass', async () => {
    const before = await countBypassLogs()
    const n = await runGovernedAggregate(context('compliance_reporting'), async (c) => {
      // consent_admin_event is GRANTed only to bank_internal_view — readable here, denied to ofbo_app.
      const r = await c.query(`SELECT count(*)::int AS n FROM consent_admin_event`)
      const rowCount = r.rows[0].n as number
      return { result: rowCount, rowCount }
    })
    expect(typeof n).toBe('number')
    expect(await countBypassLogs()).toBe(before + 1) // exactly one durable bypass record
  })

  it('REJECTS an unregistered purpose before any read — and writes no audit row', async () => {
    const before = await countBypassLogs()
    await expect(
      runGovernedAggregate(context(`unregistered_${randomUUID()}`), async () => ({ result: 1, rowCount: 1 }))
    ).rejects.toBeInstanceOf(GovernedQueryError)
    expect(await countBypassLogs()).toBe(before) // nothing logged for a rejected bypass
  })

  it('a tenant-scoped role (ofbo_app) cannot read the cross-fintech MV', async () => {
    const c = await pool.connect()
    try {
      await c.query(beginAppTx(BANK))
      await expect(c.query(`SELECT * FROM consent_admin_event LIMIT 1`)).rejects.toThrow(/permission denied/i)
      await c.query('ROLLBACK')
    } finally {
      c.release()
    }
  })
})
