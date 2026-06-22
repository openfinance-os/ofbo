import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgComplianceReportStore, PgLineageEmitter, PgReconciliationBreakStore, PgReconciliationLogStore } from '@ofbo/db'
import { ReconciliationService } from '../src/reconciliation/service.js'

/**
 * BACKOFFICE-06 integration: the monthly sign-off aggregates the month's runs +
 * breaks, persists a locked (status=approved, IdP-attested approved_by)
 * compliance_report with an integrity hash + summary content under RLS, and emits
 * compliance_report lineage + the sign-off audit — against real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const PERIOD = '2026-11'
const WINDOW = { start: '2026-11-14T00:00:00.000Z', end: '2026-11-15T00:00:00.000Z' }

const FINANCE = { subject: 'demo:finance-analyst', persona: 'finance-analyst' as const, scopes: ['finance:reconciliation:write'] }

describe('monthly sign-off — aggregate + locked report + lineage + audit', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const logStore = new PgReconciliationLogStore(url!, TENANCY, lineage)
  const breakStore = new PgReconciliationBreakStore(url!, TENANCY, lineage)
  const reports = new PgComplianceReportStore(url!, TENANCY, lineage)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(url!)
    await admin.query(`DELETE FROM reconciliation_break WHERE run_id LIKE 'recon-2026-11-%'`)
    await admin.query(`DELETE FROM reconciliation_log WHERE run_id LIKE 'recon-2026-11-%'`)
  })
  afterAll(async () => {
    await logStore.close()
    await breakStore.close()
    await reports.close()
    await audit.close()
    await lineage.close()
    await admin.end()
  })

  it('persists a locked monthly compliance_report with the summary + integrity hash', async () => {
    const seed = new ReconciliationService({ store: logStore, breakStore, audit })
    await seed.runDaily(randomUUID(), { window: WINDOW }) // 8 breaks in 2026-11

    const trace = randomUUID()
    const service = new ReconciliationService({ store: logStore, breakStore, reports, audit })
    // post-four-eyes execution (the route now requests an approval; the operation executes
    // this on approval — see the unit spec for the 202 + approve flow). Attested to the initiator.
    const report = await service.executeMonthlySignoff(PERIOD, FINANCE.subject, FINANCE.persona, trace)
    expect(report.report_type).toBe('monthly_reconciliation')
    expect(report.status).toBe('approved')
    expect(report.approved_by).toBe('demo:finance-analyst')
    expect(report.integrity_hash).toMatch(/^[0-9a-f]{64}$/)

    const row = await admin.query(
      `SELECT report_type, status, classification, approved_by, integrity_hash, content FROM compliance_report WHERE id = $1`,
      [report.id]
    )
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0].status).toBe('approved')
    expect(row.rows[0].classification).toBe('restricted')
    expect(row.rows[0].approved_by).toBe('demo:finance-analyst')
    expect(row.rows[0].content.period).toBe(PERIOD)
    expect(row.rows[0].content.breaks.total).toBe(8)
    expect(row.rows[0].content.run_count).toBe(1)

    expect((await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'compliance_report'`, [trace])).rows.length).toBeGreaterThan(0)
    expect((await admin.query(`SELECT 1 FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'reconciliation_monthly_signoff'`, [trace])).rows).toHaveLength(1)
  })
})
