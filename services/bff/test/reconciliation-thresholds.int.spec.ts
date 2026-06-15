import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgLineageEmitter, PgReconciliationLogStore, PgReconciliationBreakStore, PgReconciliationThresholdStore } from '@ofbo/db'
import { ReconciliationService } from '../src/reconciliation/service.js'
import { mintScopes, type Principal } from '../src/auth.js'

/**
 * BACKOFFICE-12 integration: threshold edits persist under RLS, emit BCBS 239
 * lineage, and the engine reads them at run time. The update is High-class audited
 * (old/new). Against real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const OPS: Principal = { subject: 'demo:operations-analyst', persona: 'operations-analyst', scopes: mintScopes('operations-analyst') }

describe('reconciliation thresholds — persistence + lineage + audit under RLS', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const thresholdStore = new PgReconciliationThresholdStore(url!, TENANCY, lineage)
  const logStore = new PgReconciliationLogStore(url!, TENANCY, lineage)
  const breakStore = new PgReconciliationBreakStore(url!, TENANCY, lineage)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(url!)
    await admin.query(`DELETE FROM reconciliation_threshold WHERE bank_id = $1`, [TENANCY.bankId])
  })
  afterAll(async () => {
    await thresholdStore.close()
    await logStore.close()
    await breakStore.close()
    await audit.close()
    await lineage.close()
    await admin.end()
  })

  it('updateThresholds persists the set under RLS, emits lineage, and audits old/new', async () => {
    const service = new ReconciliationService({ store: logStore, breakStore, thresholdStore, audit })
    const trace = randomUUID()
    const result = await service.updateThresholds(OPS, [{ fee_class: 'nebras_fees', threshold_value: 750, unit: 'aed' }], trace)
    expect(result.find((t) => t.fee_class === 'nebras_fees')!.threshold_value).toBe(750)

    // persisted under tenancy
    const row = await admin.query(`SELECT threshold_value, unit, updated_by FROM reconciliation_threshold WHERE bank_id = $1 AND fee_class = 'nebras_fees'`, [TENANCY.bankId])
    expect(row.rows).toHaveLength(1)
    expect(Number(row.rows[0].threshold_value)).toBe(750)
    expect(row.rows[0].updated_by).toBe('demo:operations-analyst')

    // BCBS 239 lineage for reconciliation_threshold
    const lin = await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'reconciliation_threshold'`, [trace])
    expect(lin.rows.length).toBeGreaterThan(0)

    // High-class audit captured the change
    const ev = await admin.query(`SELECT acting_persona FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'reconciliation_thresholds_updated'`, [trace])
    expect(ev.rows).toHaveLength(1)
    expect(ev.rows[0].acting_persona).toBe('operations-analyst')

    // the store reads back the persisted override (engine reads it at run time)
    const listed = await thresholdStore.list()
    expect(listed.find((t) => t.fee_class === 'nebras_fees')!.threshold_value).toBe(750)

    // upsert in place: a second edit updates the same row, not a duplicate
    await service.updateThresholds(OPS, [{ fee_class: 'nebras_fees', threshold_value: 800, unit: 'aed' }], randomUUID())
    const count = await admin.query(`SELECT count(*)::int AS n FROM reconciliation_threshold WHERE bank_id = $1 AND fee_class = 'nebras_fees'`, [TENANCY.bankId])
    expect(count.rows[0].n).toBe(1)
  })
})
