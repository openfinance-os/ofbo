import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { applyMigrations } from '../src/apply.js'
import { PgAuditEmitter } from '../src/audit.js'
import { SYSTEM_ACTOR_SCOPE, UNSCOPED_AUTH_EVENT_SCOPE } from '../src/audit.js'
import { retentionStatus, withDenialLogging } from '../src/retention.js'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required for integration tests')

const BANK = '11111111-1111-4111-8111-111111111111'
const TRACE = `retention-int-${crypto.randomUUID()}` // unique per run

describe('BACKOFFICE-50 — retention lifecycle', () => {
  const admin = new pg.Pool({ connectionString: url })
  let audit: PgAuditEmitter

  beforeAll(async () => {
    await applyMigrations(url)
    audit = new PgAuditEmitter(url, { bankId: BANK, channel: 'internal_retail' })
  })
  afterAll(async () => {
    await audit.close()
    await admin.end()
  })

  it('seeds the binding retention policy: 24-month hot, 60-month immutable, no deletion path', async () => {
    const r = await admin.query(`SELECT table_name, hot_months, immutable_months, deletion_allowed FROM retention_policy ORDER BY table_name`)
    const tables = r.rows.map((x) => x.table_name)
    for (const t of ['audit_high_sensitivity', 'compliance_report', 'dispute_case', 'reconciliation_break', 'lineage_events']) {
      expect(tables, t).toContain(t)
    }
    for (const row of r.rows) {
      expect(row.hot_months).toBe(24)
      expect(row.immutable_months).toBe(60)
      expect(row.deletion_allowed).toBe(false)
    }
  })

  it('a denied DELETE on a regulated table is rethrown AND High-class logged', async () => {
    const attempt = withDenialLogging(audit, {
      acting_principal: 'demo:operations-analyst',
      acting_persona: 'operations-analyst',
      trace_id: TRACE
    })
    await expect(
      attempt('audit_high_sensitivity', async () => {
        const c = await admin.connect()
        try {
          await c.query('BEGIN')
          await c.query('SET LOCAL ROLE ofbo_app')
          await c.query(`SELECT set_config('app.bank_id', $1, true)`, [BANK])
          await c.query(`DELETE FROM audit_high_sensitivity`)
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
      `SELECT event_type, scope_used, response_status, acting_principal,
              request_body_redacted->>'attempted_table' AS t FROM audit_high_sensitivity
       WHERE request_trace_id = $1 AND event_type = 'regulated_record_mutation_denied'`,
      [TRACE]
    )
    expect(logged.rows).toHaveLength(1)
    expect(logged.rows[0].t).toBe('audit_high_sensitivity')

    // CODE-03: the actor here is a PERSON — DenialActor carries their principal and persona, and the
    // row records it. So the row must not claim a system actor. A sweep that stamped the SYSTEM
    // sentinel here wrote "no principal authorised this" onto a named human's denied attempt to
    // mutate a regulated record, permanently, in the one table with no correction path. Nothing
    // asserted the column, which is why the wrong value survived review.
    expect(logged.rows[0].acting_principal).toBe('demo:operations-analyst')
    expect(logged.rows[0].scope_used).toBe(UNSCOPED_AUTH_EVENT_SCOPE)
    expect(logged.rows[0].scope_used).not.toBe(SYSTEM_ACTOR_SCOPE)
    // Both halves stay coherent: a human acted, no scope mediated it, a real 403 was served.
    expect(logged.rows[0].response_status).toBe(403)
  })

  it('non-permission errors pass through unlogged (only denials are audit events)', async () => {
    const attempt = withDenialLogging(audit, {
      acting_principal: 'demo:operations-analyst',
      acting_persona: 'operations-analyst',
      trace_id: `${TRACE}-other`
    })
    await expect(
      attempt('reconciliation_log', async () => {
        throw new Error('network blip')
      })
    ).rejects.toThrow('network blip')
    const logged = await admin.query(
      `SELECT count(*)::int AS n FROM audit_high_sensitivity WHERE request_trace_id = $1`,
      [`${TRACE}-other`]
    )
    expect(logged.rows[0].n).toBe(0)
  })

  it('retentionStatus reports per-table posture for the Compliance View', async () => {
    const status = await retentionStatus(url)
    const auditRow = status.find((s) => s.table_name === 'audit_high_sensitivity')
    expect(auditRow).toBeDefined()
    expect(auditRow!.row_count).toBeGreaterThan(0)
    expect(auditRow!.hot_months).toBe(24)
    expect(auditRow!.due_for_warm_tier).toBe(0) // nothing older than 24 months in a fresh demo db
    expect(auditRow!.oldest_record_at).toBeTruthy()
  })
})
