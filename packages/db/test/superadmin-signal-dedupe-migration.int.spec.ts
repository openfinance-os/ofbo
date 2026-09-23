import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { applyMigrations } from '../src/apply.js'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required for integration tests')

const BANK = '11111111-1111-4111-8111-111111111111'
const MIGRATION = readFileSync(
  fileURLToPath(new URL('../migrations/0044_superadmin_session_signal_dedupe.sql', import.meta.url)),
  'utf8'
)

/**
 * BACKOFFICE-80 — migration 0044 closes the per-request duplicates the guardrail wrote before the
 * durable dedupe, WITHOUT deleting a regulated record, and accounts for the closures in the audit
 * trail. The migration is re-runnable SQL, so the test replays it over rows it seeds itself.
 */
describe('migration 0044 — duplicate super-admin session signals', () => {
  const admin = new pg.Pool({ connectionString: url })
  const principal = `demo:sa-dedupe-${crypto.randomUUID()}`
  const insert = (createdAt: string, extra: Record<string, unknown> = {}) =>
    admin.query(
      `INSERT INTO risk_signal (bank_id, channel, signal_type, severity, status, signal_data, created_at)
       VALUES ($1, 'internal_retail', 'agent_anomaly', 'info', 'open', $2::jsonb, $3)`,
      [BANK, JSON.stringify({ acting_principal: principal, summary: 'super-admin session active', trace_id: 't', ...extra }), createdAt]
    )

  beforeAll(async () => {
    await applyMigrations(url)
  })
  afterAll(async () => {
    await admin.end()
  })

  it('keeps the earliest signal per principal per 8h window open, closes the rest, deletes nothing', async () => {
    // 8h buckets are aligned to the epoch: 00:00–08:00 UTC is one bucket
    await insert('2026-09-01T01:00:00Z')
    await insert('2026-09-01T02:00:00Z')
    await insert('2026-09-01T03:00:00Z')
    await insert('2026-09-01T09:00:00Z') // next session window — kept
    await insert('2026-09-01T01:30:00Z', { dedup_key: 'superadmin_session:x' }) // written by the durable dedupe — untouched
    const client = await admin.connect()
    try {
      await client.query('BEGIN')
      await client.query(MIGRATION)
      await client.query('COMMIT')
    } finally {
      client.release()
    }
    const rows = await admin.query(
      `SELECT status, created_at, signal_data FROM risk_signal WHERE signal_data->>'acting_principal' = $1 ORDER BY created_at`,
      [principal]
    )
    expect(rows.rows).toHaveLength(5)
    const byStatus = (s: string) => rows.rows.filter((r) => r.status === s)
    expect(byStatus('closed_no_action')).toHaveLength(2)
    expect(byStatus('open').map((r) => (r.created_at as Date).toISOString())).toEqual([
      '2026-09-01T01:00:00.000Z',
      '2026-09-01T01:30:00.000Z',
      '2026-09-01T09:00:00.000Z'
    ])
    for (const r of byStatus('closed_no_action')) {
      expect(r.signal_data.closed_by_migration).toBe('0044_superadmin_session_signal_dedupe')
    }
    const audit = await admin.query(
      `SELECT request_body_redacted FROM audit_high_sensitivity
        WHERE request_trace_id = 'migration-0044-superadmin-session-signal-dedupe' AND bank_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [BANK]
    )
    expect(audit.rows[0].request_body_redacted).toMatchObject({ to_status: 'closed_no_action' })
    expect(Number(audit.rows[0].request_body_redacted.signals_closed)).toBeGreaterThanOrEqual(2)
  })
})
