import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { applyMigrations } from '@ofbo/db'
import worker from '../src/worker.js'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required for integration tests')

const BANK = '11111111-1111-4111-8111-111111111111'

/**
 * DEMO-01 — the daily 01:00 UTC cron, driven through the Worker's own `scheduled()` entry exactly
 * as Cloudflare invokes it.
 *
 * Nothing exercised this entry end to end, and on the hosted demo it had not completed since
 * 2026-08-16: `configuredBillingProfiles` returned `Promise.all(...)` from inside a `try` without
 * awaiting it, so its `finally` closed the tenant-billing pool while the per-tenant reads were
 * still using it — "Cannot use a pool after calling end on the pool" — and `scheduled()` threw
 * before a single daily job (reconciliation, ingestion, every risk monitor) was started. Every
 * unit test of those jobs stayed green, because each is constructed directly there, never through
 * the worker.
 */
describe('worker scheduled() — the daily cron runs end to end', () => {
  const admin = new pg.Pool({ connectionString: url })
  beforeAll(async () => {
    await applyMigrations(url)
  })
  afterAll(async () => {
    await admin.end()
  })

  it('does not throw, and the daily reconciliation run lands', async () => {
    const pending: Promise<unknown>[] = []
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) }
    const env = { DATABASE_URL: url, DEPLOY_PROFILE: 'demo', BANK_ID: BANK }

    await expect(worker.scheduled({ cron: '0 1 * * *', scheduledTime: Date.now() }, env, ctx)).resolves.toBeUndefined()
    expect(pending.length).toBeGreaterThan(0)
    await Promise.allSettled(pending)

    // runDaily's run_id is `recon-<yesterday>-daily`.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    const run = await admin.query(`SELECT status FROM reconciliation_log WHERE run_id = $1 LIMIT 1`, [`recon-${yesterday}-daily`])
    expect(run.rowCount).toBe(1)
  })

  // Once the cron runs again, the LFI cadence monitor must not add a fresh open signal per overdue
  // report on every run — it did, 16 a day, until the dashboard was paging through 897 of them.
  it('a second daily run adds no LFI cadence signal for a report whose signal is still open', async () => {
    const openCadence = async () =>
      Number((await admin.query(
        `SELECT count(*) AS n FROM risk_signal WHERE signal_type = 'lfi_report_cadence_missed' AND status = 'open' AND bank_id = $1`,
        [BANK]
      )).rows[0].n)
    const runDaily = async () => {
      const pending: Promise<unknown>[] = []
      await worker.scheduled({ cron: '0 1 * * *', scheduledTime: Date.now() }, { DATABASE_URL: url, DEPLOY_PROFILE: 'demo', BANK_ID: BANK }, { waitUntil: (p: Promise<unknown>) => void pending.push(p) })
      await Promise.allSettled(pending)
    }
    await runDaily()
    const afterFirst = await openCadence()
    await runDaily()
    expect(await openCadence()).toBe(afterFirst)
  })

  it('the warmth tick drains superseded cadence signals down to one open per report', async () => {
    const report = `sa-sweep-${crypto.randomUUID()}`
    for (const hoursAgo of [72, 48, 24]) {
      await admin.query(
        `INSERT INTO risk_signal (bank_id, channel, signal_type, severity, status, signal_data, created_at)
         VALUES ($1, 'internal_retail', 'lfi_report_cadence_missed', 'medium', 'open', $2::jsonb, now() - ($3 || ' hours')::interval)`,
        [BANK, JSON.stringify({ dedup_key: `lfi-cadence:${report}`, summary: 'overdue', trace_id: 't' }), String(hoursAgo)]
      )
    }
    const pending: Promise<unknown>[] = []
    await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: Date.now() }, { DATABASE_URL: url, DEPLOY_PROFILE: 'demo', BANK_ID: BANK }, { waitUntil: (p: Promise<unknown>) => void pending.push(p) })
    await Promise.allSettled(pending)
    const rows = await admin.query(
      `SELECT status FROM risk_signal WHERE signal_data->>'dedup_key' = $1 ORDER BY created_at`,
      [`lfi-cadence:${report}`]
    )
    expect(rows.rows.map((r) => r.status)).toEqual(['closed_no_action', 'closed_no_action', 'open']) // newest stays open
  })
})
