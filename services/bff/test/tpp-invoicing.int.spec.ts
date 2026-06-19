import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgBillingRecordStore, PgInvoiceRunStore, PgLineageEmitter, PgReconciliationBreakStore } from '@ofbo/db'
import { InvoicingService } from '../src/tpp-billing/invoicing.js'

/**
 * BACKOFFICE-73 integration: ingest persists billing_record_set under RLS with an
 * integrity hash + lineage; reconcile compares against the bank metering, creates
 * reconciliation_break rows for variances, and transitions the record set; an
 * invoice run persists under RLS with lineage — against real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const PERIOD = '2026-05'
const FINANCE = { subject: 'demo:finance-analyst', persona: 'finance-analyst' as const, scopes: ['billing:write', 'billing:read', 'finance:reconciliation:write'] }

class NoopApprovals {
  async requestApproval() {
    return { approval_request_id: randomUUID(), operation_type: 'tpp.invoice_run', operation_payload: {}, state: 'pending' as const, initiator: FINANCE.subject, approver_required_scope: 'billing:write', approver: null, expires_at: new Date().toISOString(), reject_reason: null }
  }
}

describe('TPP invoicing — ingest + reconcile + invoice run persistence + lineage', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const billingStore = new PgBillingRecordStore(url!, TENANCY, lineage)
  const invoiceStore = new PgInvoiceRunStore(url!, TENANCY, lineage)
  const breakStore = new PgReconciliationBreakStore(url!, TENANCY, lineage)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(url!)
  })
  afterAll(async () => {
    await billingStore.close()
    await invoiceStore.close()
    await breakStore.close()
    await audit.close()
    await lineage.close()
    await admin.end()
  })

  it('ingest → reconcile (breaks) → invoice run, all under RLS with lineage', async () => {
    const svc = new InvoicingService({ billingStore, invoiceStore, breakSink: breakStore, approvals: new NoopApprovals(), audit })
    const trace = randomUUID()

    const rec = await svc.ingest(FINANCE, { billing_period: PERIOD, source_note: 'int', fileBytes: new Uint8Array([9, 9, 9]) }, trace)
    expect(rec.status).toBe('ingested')
    expect(rec.integrity_hash).toMatch(/^[0-9a-f]{64}$/)
    const row = await admin.query(`SELECT status, integrity_hash, line_count FROM billing_record_set WHERE id = $1`, [rec.record_set_id])
    expect(row.rows).toHaveLength(1)
    expect(Number(row.rows[0].line_count)).toBeGreaterThan(0)
    expect((await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'billing_record_set'`, [trace])).rows.length).toBeGreaterThan(0)

    const reconTrace = randomUUID()
    const reconciled = await svc.reconcile(FINANCE, rec.record_set_id, reconTrace)
    expect(reconciled.status).toBe('reconciled_with_breaks') // the sim period carries fee variances
    expect(reconciled.open_break_count).toBeGreaterThan(0)
    // Scope the count to THIS run's breaks. run_id is bill-<period>-<record_set_id[0:8]>
    // (invoicing.ts), unique per ingest — a period-wide LIKE would also count breaks
    // left by earlier runs against the shared DB and over-count (false failure).
    const runId = `bill-${PERIOD}-${rec.record_set_id.slice(0, 8)}`
    const breakRows = await admin.query(`SELECT count(*)::int AS n FROM reconciliation_break WHERE run_id = $1`, [runId])
    expect(breakRows.rows[0].n).toBe(reconciled.open_break_count)

    // invoice run create is blocked by unresolved breaks (409) — flip the record set
    // clean to exercise the invoice_run write path under RLS.
    await billingStore.markReconciled(rec.record_set_id, 'reconciled_clean', 0, [], randomUUID())
    const irTrace = randomUUID()
    await svc.createInvoiceRun(FINANCE, { billing_period: PERIOD, record_set_id: rec.record_set_id }, irTrace)
    const inv = await admin.query(`SELECT status, billing_period FROM invoice_run WHERE record_set_id = $1`, [rec.record_set_id])
    expect(inv.rows.length).toBeGreaterThan(0)
    expect(inv.rows[0].status).toBe('pending_approval')
    expect((await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'invoice_run'`, [irTrace])).rows.length).toBeGreaterThan(0)
  })
})
