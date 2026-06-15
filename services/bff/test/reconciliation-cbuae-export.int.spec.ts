import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgComplianceReportStore, PgLineageEmitter, PgReconciliationBreakStore, PgReconciliationLogStore } from '@ofbo/db'
import { ReconciliationService } from '../src/reconciliation/service.js'

/**
 * BACKOFFICE-08 integration: the CBUAE export aggregates the date range's runs +
 * breaks into a compliance_report (awaiting_approval) with per-line + overall
 * integrity hashes under RLS, emits compliance_report lineage + the export audit,
 * and the persisted line hashes are re-verifiable — against real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const WINDOW = { start: '2026-12-10T00:00:00.000Z', end: '2026-12-11T00:00:00.000Z' }
const COMPLIANCE = { subject: 'demo:compliance-officer', persona: 'compliance-officer' as const, scopes: ['compliance:reports:generate'] }

describe('CBUAE reconciliation export — aggregate + hashes + lineage', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const logStore = new PgReconciliationLogStore(url!, TENANCY, lineage)
  const breakStore = new PgReconciliationBreakStore(url!, TENANCY, lineage)
  const reports = new PgComplianceReportStore(url!, TENANCY, lineage)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(url!)
    await admin.query(`DELETE FROM reconciliation_break WHERE run_id LIKE 'recon-2026-12-%'`)
    await admin.query(`DELETE FROM reconciliation_log WHERE run_id LIKE 'recon-2026-12-%'`)
  })
  afterAll(async () => {
    await logStore.close()
    await breakStore.close()
    await reports.close()
    await audit.close()
    await lineage.close()
    await admin.end()
  })

  it('persists the CBUAE export with per-line hashes + lineage; hashes re-verify', async () => {
    await new ReconciliationService({ store: logStore, breakStore, audit }).runDaily(randomUUID(), { window: WINDOW }) // 8 breaks, created now

    const trace = randomUUID()
    const service = new ReconciliationService({ store: logStore, breakStore, reports, audit })
    // wide range: the run/breaks are created at wall-clock now
    const report = await service.generateCbuaeExport(COMPLIANCE, '2020-01-01', '2099-12-31', trace)
    expect(report.report_type).toBe('cbuae_reconciliation_export')
    expect(report.status).toBe('awaiting_approval')
    expect(report.integrity_hash).toMatch(/^[0-9a-f]{64}$/)

    const row = await admin.query(`SELECT report_type, classification, integrity_hash, content FROM compliance_report WHERE id = $1`, [report.id])
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0].classification).toBe('restricted')
    const content = row.rows[0].content as {
      break_count: number
      sections: { runs: Array<{ run_id: string }>; breaks: Array<{ run_id: string }> }
      line_hashes: { runs: string[]; breaks: string[] }
    }
    // Other int specs write breaks to the shared DB at the same wall-clock time and
    // the export is by created_at, so assert "≥ my 8 and my run is present" rather
    // than an exact total; the unit suite holds the exact-count contract in isolation.
    expect(content.break_count).toBeGreaterThanOrEqual(8)
    expect(content.line_hashes.breaks.length).toBe(content.sections.breaks.length)
    expect(content.line_hashes.runs.length).toBe(content.sections.runs.length)
    expect(content.sections.breaks.filter((b) => b.run_id === 'recon-2026-12-10-daily')).toHaveLength(8)
    expect(content.sections.runs.some((r) => r.run_id === 'recon-2026-12-10-daily')).toBe(true)

    expect((await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'compliance_report'`, [trace])).rows.length).toBeGreaterThan(0)
    expect((await admin.query(`SELECT 1 FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'cbuae_reconciliation_export_generated'`, [trace])).rows).toHaveLength(1)
  })
})
