import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgComplianceReportStore, PgApprovalStore, PgAuditEmitter, PgLineageEmitter } from '@ofbo/db'
import { ApprovalsService } from '../src/approvals/service.js'
import { InMemoryAuthAuditSink } from '../src/auth.js'
import { ReportGenerationService, makeReportGenerationOperation, REPORT_GENERATION_OPERATION } from '../src/reports/generation.js'
import type { Principal } from '../src/auth.js'

/**
 * BACKOFFICE-35 integration: a CBUAE-bound report persists under RLS (awaiting_approval
 * + approval_id) with BCBS 239 lineage; a Programme Manager four-eyes-approves it via the
 * approvals service (initiator ≠ approver) → approved; submit → submitted — real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const officer: Principal = { subject: 'demo:compliance', persona: 'compliance-officer', scopes: ['compliance:reports:generate', 'compliance:reports:read'] }
const programme: Principal = { subject: 'demo:pm', persona: 'programme-manager', scopes: ['programme:read'] }

describe('Report generation — persistence + four-eyes under RLS', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const store = new PgComplianceReportStore(url!, TENANCY, lineage)
  const approvalStore = new PgApprovalStore(url!, TENANCY, lineage)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)
  const approvals = new ApprovalsService(new InMemoryAuthAuditSink(), {
    store: approvalStore,
    operations: { [REPORT_GENERATION_OPERATION]: makeReportGenerationOperation({ store }) }
  })

  beforeAll(async () => {
    await applyMigrations(url!)
  })
  afterAll(async () => {
    await store.close()
    await approvalStore.close()
    await audit.close()
    await lineage.close()
    await admin.end()
  })

  it('CBUAE report: awaiting_approval + lineage → four-eyes approve → approved → submitted', async () => {
    const svc = new ReportGenerationService({ store, approvals, audit })
    const trace = randomUUID()

    const report = await svc.generate(officer, { report_type: 'cbuae_monthly', period_start: '2026-05-01', period_end: '2026-05-31' }, trace)
    expect(report.status).toBe('awaiting_approval')
    expect(report.approval_id).toBeTruthy()
    expect(report.integrity_hash).toMatch(/^[0-9a-f]{64}$/)

    const row = await admin.query(`SELECT status, classification, approval_id FROM compliance_report WHERE id = $1`, [report.id])
    expect(row.rows[0].status).toBe('awaiting_approval')
    expect(row.rows[0].classification).toBe('restricted')
    expect((await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'compliance_report'`, [trace])).rows.length).toBeGreaterThan(0)

    // four-eyes: a different principal (programme:read) approves
    const approved = await svc.approve(programme, report.id, randomUUID())
    expect(approved.status).toBe('approved')
    expect(approved.approved_by).toBe('demo:pm')
    expect((await admin.query(`SELECT status FROM compliance_report WHERE id = $1`, [report.id])).rows[0].status).toBe('approved')

    const submitted = await svc.submit(officer, report.id, randomUUID())
    expect(submitted.status).toBe('submitted')
    expect(submitted.submitted_at).toBeTruthy()

    // download content round-trips
    const dl = await svc.download(officer, report.id, 'xlsx')
    expect(dl.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(dl.bytes.byteLength).toBeGreaterThan(0)
  })
})
