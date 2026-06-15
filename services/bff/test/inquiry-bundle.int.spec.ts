import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgComplianceReportStore, PgLineageEmitter } from '@ofbo/db'
import { generateDemoDataset } from '@ofbo/synthetic-data'
import { createApp } from '../src/app.js'

/**
 * BACKOFFICE-23 integration: generating a per-PSU inquiry bundle persists a
 * compliance_report (RLS-bound) with the line-level-hashed content + overall
 * integrity hash, emits BCBS 239 lineage for compliance_report, and writes the
 * inquiry_bundle_generated audit — against real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const psu = generateDemoDataset().psus[0]!

describe('CBUAE inquiry bundle — persistence + integrity hashes + lineage', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)
  const reports = new PgComplianceReportStore(url!, TENANCY, lineage)
  const app = createApp({ complianceReportStore: reports, audit })

  beforeAll(async () => {
    await applyMigrations(url!)
  })
  afterAll(async () => {
    await audit.close()
    await lineage.close()
    await reports.close()
    await admin.end()
  })

  it('persists the inquiry report with content hashes + lineage + audit', async () => {
    const trace = randomUUID()
    const res = await app.request('/back-office/inquiries/psu', {
      method: 'POST',
      headers: {
        'x-fapi-interaction-id': trace,
        authorization: 'Bearer demo-token:compliance-officer',
        'content-type': 'application/json',
        'idempotency-key': randomUUID()
      },
      body: JSON.stringify({ psu_identifier_type: 'bank_customer_id', psu_identifier: psu.bank_customer_id })
    })
    expect(res.status).toBe(202)
    const report = ((await res.json()) as { data: { id: string; integrity_hash: string; report_type: string } }).data
    expect(report.report_type).toBe('cbuae_psu_inquiry')

    const row = await admin.query(
      `SELECT report_type, status, classification, requested_by, integrity_hash, generated_at, content FROM compliance_report WHERE id = $1`,
      [report.id]
    )
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0].report_type).toBe('cbuae_psu_inquiry')
    expect(row.rows[0].classification).toBe('restricted')
    expect(row.rows[0].integrity_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(row.rows[0].generated_at).toBeTruthy()
    // line-level hashes persisted in the bundle content
    expect(row.rows[0].content.line_hashes.consents.length).toBe(psu.consents.length)

    const lin = await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'compliance_report'`, [trace])
    expect(lin.rows.length).toBeGreaterThan(0)

    const ev = await admin.query(
      `SELECT 1 FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'inquiry_bundle_generated'`,
      [trace]
    )
    expect(ev.rows).toHaveLength(1)
  })
})
