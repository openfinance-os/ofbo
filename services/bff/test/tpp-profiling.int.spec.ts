import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgLineageEmitter, PgRiskSignalEmitter, PgAnomalyDetectionStore } from '@ofbo/db'
import { TppBehaviourProfiler, DemoTppActivitySource } from '../src/risk/tpp-profiling.js'

/**
 * BACKOFFICE-38 integration: the profiler emits tpp_behaviour Risk signals for the
 * deterministic demo TPPs that breach 3σ, persisted under RLS with the client id +
 * dedup key, and a second run dedups (no re-emit). Real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }

describe('TPP behavioural profiling — signals persist under RLS + dedup', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const signals = new PgRiskSignalEmitter(url!, TENANCY, lineage)
  const dedup = new PgAnomalyDetectionStore(url!, TENANCY)

  beforeAll(async () => {
    await applyMigrations(url!)
    await admin.query(`DELETE FROM risk_signal WHERE signal_type = 'tpp_behaviour'`)
  })
  afterAll(async () => {
    await signals.close()
    await dedup.close()
    await lineage.close()
    await admin.end()
  })

  it('emits tpp_behaviour for the >3σ demo TPPs, persisted under RLS, then dedups', async () => {
    const profiler = new TppBehaviourProfiler({ source: new DemoTppActivitySource(), signals, dedup })
    const out = await profiler.profile(randomUUID())

    // the demo source has exactly two >3σ TPPs (a3 volume spike, a4 off-hours + CoP)
    const emitted = out.filter((r) => r.emitted)
    expect(emitted).toHaveLength(2)

    const rows = await admin.query(`SELECT signal_type, client_id, signal_data->>'dedup_key' AS dedup_key FROM risk_signal WHERE signal_type = 'tpp_behaviour' ORDER BY client_id`)
    expect(rows.rows).toHaveLength(2)
    expect(rows.rows.every((r) => r.client_id && r.dedup_key?.startsWith('tpp_behaviour|'))).toBe(true)

    // second run dedups against the open signals — no new rows
    const second = await profiler.profile(randomUUID())
    expect(second.filter((r) => r.emitted)).toHaveLength(0)
    const after = await admin.query(`SELECT count(*)::int AS n FROM risk_signal WHERE signal_type = 'tpp_behaviour'`)
    expect(after.rows[0].n).toBe(2)
  })
})
