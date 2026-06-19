import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgComplianceReportStore, PgLineageEmitter } from '@ofbo/db'
import { createApp } from '../src/app.js'

/**
 * BACKOFFICE-67 — verified LFI ingest persists a compliance_report (with integrity
 * hash) + one High-class audit + lineage over real Postgres (RLS via ofbo_app).
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }

describe('LFI report ingest — persistence + audit + lineage', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)
  const reportStore = new PgComplianceReportStore(url!, TENANCY, lineage)
  const app = createApp({ reportStore, audit })

  beforeAll(async () => {
    await applyMigrations(url!)
  }, 60_000)
  afterAll(async () => {
    await audit.close()
    await lineage.close()
    await reportStore.close()
    await admin.end()
  })

  it('ingests an LFI report → compliance_report row (integrity hash) + audit + lineage', async () => {
    const trace = randomUUID()
    const fd = new FormData()
    fd.append('file', new Blob([`availability,uptime\n2026-06,${trace}`], { type: 'text/csv' }), 'availability.csv')
    fd.append('report_type', 'availability')
    fd.append('report_period', '2026-06-15')

    const res = await app.request('/back-office/lfi-reports', {
      method: 'POST',
      headers: { 'x-fapi-interaction-id': trace, authorization: 'Bearer demo-token:compliance-officer', 'idempotency-key': randomUUID() },
      body: fd
    })
    expect(res.status).toBe(201)
    const created = ((await res.json()) as { data: { id: string; integrity_hash: string } }).data
    expect(created.integrity_hash).toMatch(/^[0-9a-f]{64}$/)

    const row = await admin.query(`SELECT report_type, status, integrity_hash FROM compliance_report WHERE id = $1`, [created.id])
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0]).toMatchObject({ report_type: 'lfi_report:availability', status: 'archived' })
    expect(row.rows[0].integrity_hash).toBe(created.integrity_hash)

    const ev = await admin.query(
      `SELECT 1 FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'lfi_report_ingested'`,
      [trace]
    )
    expect(ev.rows).toHaveLength(1)

    const lin = await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'compliance_report'`, [trace])
    expect(lin.rows.length).toBeGreaterThan(0)

    // cadence dashboard now shows availability not-overdue
    const cadence = await app.request('/back-office/lfi-reports', {
      headers: { 'x-fapi-interaction-id': randomUUID(), authorization: 'Bearer demo-token:compliance-officer' }
    })
    const rows = ((await cadence.json()) as { data: { report_type: string; overdue: boolean }[] }).data
    expect(rows.find((r) => r.report_type === 'availability')!.overdue).toBe(false)
  }, 60_000)
})
