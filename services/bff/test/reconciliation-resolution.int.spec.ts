import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgLineageEmitter, PgReconciliationBreakStore } from '@ofbo/db'

/**
 * BACKOFFICE-04 integration: resolve transitions a break to a terminal outcome
 * under RLS with the note persisted + lineage; reopen returns it to flagged,
 * clears the resolution, increments reopened_count, and emits lineage — against
 * real Postgres. Both transitions are guarded (no double-resolve / no reopen of
 * a non-terminal break).
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const RUN_ID = 'recon-resolution-int-run'
const NOTE = 'Internal correction applied; Nebras line matches after adjustment.'

describe('break resolve + reopen — RLS transitions + lineage + guards', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const store = new PgReconciliationBreakStore(url!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(url!)
    await admin.query(`DELETE FROM reconciliation_break WHERE run_id = $1`, [RUN_ID])
  })
  afterAll(async () => {
    await store.close()
    await lineage.close()
    await admin.end()
  })

  it('resolves then reopens, with guards and lineage', async () => {
    const [created] = await store.createMany(
      [{ run_id: RUN_ID, line_type: 'payment_settlement', variance_amount: { amount: 9, currency: 'AED' }, source_a_ref: 'N1', source_b_ref: 'P1' }],
      randomUUID()
    )
    const id = created!.id

    const resolveTrace = randomUUID()
    const resolved = await store.resolve(id, 'resolved_internal_correction', NOTE, resolveTrace)
    expect(resolved?.status).toBe('resolved_internal_correction')
    expect(resolved?.resolution_note).toBe(NOTE)
    const r1 = await admin.query(`SELECT status, resolution_outcome, resolution_note FROM reconciliation_break WHERE id = $1`, [id])
    expect(r1.rows[0].status).toBe('resolved_internal_correction')
    expect(r1.rows[0].resolution_note).toBe(NOTE)
    expect((await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'reconciliation_break'`, [resolveTrace])).rows.length).toBeGreaterThan(0)

    // double-resolve guard: terminal status ⇒ 0-row no-op
    expect(await store.resolve(id, 'resolved_matched', NOTE, randomUUID())).toBeNull()

    // reopen → flagged, cleared, reopened_count incremented
    const reopenTrace = randomUUID()
    const reopened = await store.reopen(id, reopenTrace)
    expect(reopened?.status).toBe('flagged')
    expect(reopened?.assigned_to).toBeNull()
    expect(reopened?.resolution_outcome).toBeNull()
    expect(reopened?.reopened_count).toBe(1)
    const r2 = await admin.query(`SELECT status, resolution_note, reopened_count FROM reconciliation_break WHERE id = $1`, [id])
    expect(r2.rows[0].status).toBe('flagged')
    expect(r2.rows[0].resolution_note).toBeNull()
    expect(r2.rows[0].reopened_count).toBe(1)
    expect((await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'reconciliation_break'`, [reopenTrace])).rows.length).toBeGreaterThan(0)

    // reopen guard: a flagged (non-terminal) break cannot be reopened
    expect(await store.reopen(id, randomUUID())).toBeNull()
  })
})
