import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { applyMigrations } from '../src/apply.js'
import { PgLineageEmitter, validateLineageCoverage } from '../src/lineage.js'
import { PgRiskSignalEmitter } from '../src/risk-signal.js'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required for integration tests')

const BANK = '11111111-1111-4111-8111-111111111111'
const TRACE = `lineage-risk-int-${crypto.randomUUID()}` // unique per run

/**
 * M1-LINEAGE-RISK-SIGNAL: the risk_signal write path (BACKOFFICE-80) must emit
 * column-level lineage at write time, exactly like the audit path (BACKOFFICE-49).
 * Without it the Q4.5 BCBS 239 coverage check flags risk_signal as a gap the
 * moment a super-admin session writes a signal.
 */
describe('M1-LINEAGE-RISK-SIGNAL — risk_signal emits lineage at write time', () => {
  const admin = new pg.Pool({ connectionString: url })
  let lineage: PgLineageEmitter
  let risk: PgRiskSignalEmitter

  beforeAll(async () => {
    await applyMigrations(url)
    lineage = new PgLineageEmitter(url, { bankId: BANK, channel: 'internal_retail' })
    risk = new PgRiskSignalEmitter(url, { bankId: BANK, channel: 'internal_retail' }, lineage)
  })
  afterAll(async () => {
    await risk.close()
    await lineage.close()
    await admin.end()
  })

  it('a risk-signal write emits column-level lineage with the trace id, at write time', async () => {
    await risk.record({
      signal_type: 'agent_anomaly',
      severity: 'info',
      acting_principal: 'demo:platform-super-admin',
      summary: 'super-admin session active',
      trace_id: TRACE
    })
    const r = await admin.query(
      `SELECT table_name, columns, source FROM lineage_events WHERE trace_id = $1 AND table_name = 'risk_signal'`,
      [TRACE]
    )
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].columns).toContain('signal_type')
    expect(r.rows[0].columns).toContain('signal_data')
    expect(r.rows[0].source).toBe('bff-risk-signal-emitter')
  })

  it('lineage failure never blocks the underlying risk-signal write (emission is best-effort)', async () => {
    const broken = new PgRiskSignalEmitter(url, { bankId: BANK, channel: 'internal_retail' }, {
      emitLineage: async () => {
        throw new Error('catalogue down')
      }
    })
    const trace = `${TRACE}-broken`
    await broken.record({
      signal_type: 'agent_anomaly',
      severity: 'info',
      acting_principal: 'demo:platform-super-admin',
      summary: 'super-admin session active',
      trace_id: trace
    })
    const r = await admin.query(`SELECT count(*)::int AS n FROM risk_signal WHERE signal_data->>'trace_id' = $1`, [trace])
    expect(r.rows[0].n).toBe(1)
    await broken.close()
  })

  it('validateLineageCoverage (Q4.5) reports risk_signal as covered once a signal has lineage', async () => {
    const result = await validateLineageCoverage(url)
    expect(result.covered).toContain('risk_signal')
    expect(result.gaps).not.toContain('risk_signal')
  })
})
