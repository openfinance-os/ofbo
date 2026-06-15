import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { applyMigrations } from '../src/apply.js'
import { PgAuditEmitter } from '../src/audit.js'
import { retentionStatus, withDenialLogging } from '../src/retention.js'

/**
 * BACKOFFICE-14 — reconciliation data retention lifecycle: 24-month hot → warm
 * (columnar) → 5-year immutable; deletion forbidden by RLS. The reconciliation
 * tables carry the binding policy, DELETE is denied + High-class logged, and the
 * tier breakdown classifies records hot/warm/past-immutable by age.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required for integration tests')

const BANK = '11111111-1111-4111-8111-111111111111'
const TRACE = `recon-retention-${crypto.randomUUID()}`
const AGED_RUN = `recon-ret-aged-${crypto.randomUUID()}`

describe('BACKOFFICE-14 — reconciliation retention lifecycle', () => {
  const admin = new pg.Pool({ connectionString: url })
  let audit: PgAuditEmitter

  beforeAll(async () => {
    await applyMigrations(url)
    audit = new PgAuditEmitter(url, { bankId: BANK, channel: 'internal_retail' })
    // an aged reconciliation_log row (25 months old) → belongs in the warm tier
    await admin.query(
      `INSERT INTO reconciliation_log (bank_id, channel, run_id, run_type, status, window_start, window_end, created_at)
       VALUES ($1, 'internal_retail', $2, 'daily', 'completed', now() - interval '25 months', now() - interval '25 months', now() - interval '25 months')`,
      [BANK, AGED_RUN]
    )
  })
  afterAll(async () => {
    await audit.close()
    await admin.end()
  })

  it('seeds the binding policy for both reconciliation tables: 24 hot / 60 immutable / no deletion', async () => {
    const r = await admin.query(
      `SELECT table_name, hot_months, immutable_months, deletion_allowed FROM retention_policy
        WHERE table_name IN ('reconciliation_log','reconciliation_break') ORDER BY table_name`
    )
    expect(r.rows.map((x) => x.table_name)).toEqual(['reconciliation_break', 'reconciliation_log'])
    for (const row of r.rows) {
      expect(row.hot_months).toBe(24)
      expect(row.immutable_months).toBe(60)
      expect(row.deletion_allowed).toBe(false)
    }
  })

  for (const table of ['reconciliation_log', 'reconciliation_break']) {
    it(`a DELETE on ${table} is RLS-denied AND High-class logged`, async () => {
      const trace = `${TRACE}-${table}`
      const attempt = withDenialLogging(audit, { acting_principal: 'demo:finance-analyst', acting_persona: 'finance-analyst', trace_id: trace })
      await expect(
        attempt(table, async () => {
          const c = await admin.connect()
          try {
            await c.query('BEGIN')
            await c.query('SET LOCAL ROLE ofbo_app')
            await c.query(`SELECT set_config('app.bank_id', $1, true)`, [BANK])
            await c.query(`DELETE FROM ${table}`)
            await c.query('COMMIT')
          } catch (e) {
            await c.query('ROLLBACK').catch(() => undefined)
            throw e
          } finally {
            c.release()
          }
        })
      ).rejects.toThrow(/permission denied/)
      const logged = await admin.query(
        `SELECT request_body_redacted->>'attempted_table' AS t FROM audit_high_sensitivity
          WHERE request_trace_id = $1 AND event_type = 'regulated_record_mutation_denied'`,
        [trace]
      )
      expect(logged.rows).toHaveLength(1)
      expect(logged.rows[0].t).toBe(table)
    })
  }

  it('retentionStatus reports the hot → warm → immutable lifecycle for reconciliation_log', async () => {
    const status = await retentionStatus(url)
    const row = status.find((s) => s.table_name === 'reconciliation_log')!
    expect(row.hot_months).toBe(24)
    expect(row.immutable_months).toBe(60)
    // the 25-month-old seeded row sits in the warm tier (past hot, within immutable)
    expect(row.warm_tier_count).toBeGreaterThanOrEqual(1)
    expect(row.due_for_warm_tier).toBeGreaterThanOrEqual(1)
    expect(row.past_immutable_count).toBe(0) // nothing older than 60 months
    expect(row.row_count).toBe(row.hot_tier_count + row.warm_tier_count + row.past_immutable_count)
    expect(row.oldest_record_at).toBeTruthy()
  })
})
