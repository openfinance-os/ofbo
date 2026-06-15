import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryAuthAuditSink } from '../src/auth.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { ApprovalsService } from '../src/approvals/service.js'
import {
  InvoicingService,
  InMemoryBillingRecordStore,
  InMemoryInvoiceRunStore,
  makeInvoiceRunOperation,
  INVOICE_RUN_OPERATION
} from '../src/tpp-billing/invoicing.js'
import type { Principal } from '../src/auth.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-73 — monthly TPP invoicing, reconcile BEFORE invoice. Ingest →
 * reconcile (variances create breaks) → four-eyes invoice run (409 until
 * reconciled + breaks cleared) → P9 dispatch on approval; disputed lines withheld.
 */

const PERIOD = '2026-05'
const auth = (persona: string, extra: Record<string, string> = {}) => ({ ...FAPI_HEADERS, authorization: `Bearer demo-token:${persona}`, ...extra })

function fileForm(period = PERIOD): FormData {
  const form = new FormData()
  form.append('file', new File([new Uint8Array([1, 2, 3, 4, 5])], 'nebras-billing.csv'))
  form.append('billing_period', period)
  form.append('source_note', 'email received 2026-06-01 from billing@nebras')
  return form
}

describe('TPP invoicing pipeline (HTTP)', () => {
  let app: ReturnType<typeof createApp>
  beforeEach(() => {
    app = createApp({ billingRecordStore: new InMemoryBillingRecordStore(), invoiceRunStore: new InMemoryInvoiceRunStore() })
  })

  async function ingest(): Promise<string> {
    const res = await app.request('/back-office/billing-records', { method: 'POST', headers: auth('finance-analyst', { 'idempotency-key': 'ing1' }), body: fileForm() })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: { record_set_id: string; status: string; integrity_hash: string } }
    expect(body.data.status).toBe('ingested')
    expect(body.data.integrity_hash).toMatch(/^[0-9a-f]{64}$/)
    return body.data.record_set_id
  }

  it('ingests a billing file (integrity hash, status ingested)', async () => {
    await ingest()
  })

  it('blocks an invoice run BEFORE reconcile (reconcile-before-invoice, 409)', async () => {
    const id = await ingest()
    const res = await app.request('/back-office/invoice-runs', {
      method: 'POST',
      headers: auth('finance-analyst', { 'content-type': 'application/json', 'idempotency-key': 'ir1' }),
      body: JSON.stringify({ billing_period: PERIOD, record_set_id: id })
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BACKOFFICE.NOT_RECONCILED')
  })

  it('reconciles against the bank metering — variances create breaks (reconciled_with_breaks)', async () => {
    const id = await ingest()
    const res = await app.request(`/back-office/billing-records/${id}:reconcile`, { method: 'POST', headers: auth('finance-analyst', { 'idempotency-key': 'rec1' }) })
    expect(res.status).toBe(202)
    const body = (await res.json()) as { data: { status: string; open_break_count: number; nebras_billing_query_refs: string[] } }
    expect(body.data.status).toBe('reconciled_with_breaks') // the sim period carries fee variances
    expect(body.data.open_break_count).toBeGreaterThan(0)
    expect(body.data.nebras_billing_query_refs.length).toBe(body.data.open_break_count)

    // unresolved breaks block the invoice run (409)
    const ir = await app.request('/back-office/invoice-runs', {
      method: 'POST',
      headers: auth('finance-analyst', { 'content-type': 'application/json', 'idempotency-key': 'ir2' }),
      body: JSON.stringify({ billing_period: PERIOD, record_set_id: id })
    })
    expect(ir.status).toBe(409)
    expect(((await ir.json()) as { error: { code: string } }).error.code).toBe('BACKOFFICE.UNRESOLVED_BREAKS')
  })

  it('ingest needs billing:write (403) + Idempotency-Key (400); reconcile 404 unknown; invoice-run list is billing:read', async () => {
    expect((await app.request('/back-office/billing-records', { method: 'POST', headers: auth('customer-care-agent', { 'idempotency-key': 'x' }), body: fileForm() })).status).toBe(403)
    expect((await app.request('/back-office/billing-records', { method: 'POST', headers: auth('finance-analyst'), body: fileForm() })).status).toBe(400)
    expect((await app.request('/back-office/billing-records/4d2c2e2a-0000-4000-8000-000000000000:reconcile', { method: 'POST', headers: auth('finance-analyst', { 'idempotency-key': 'rx' }) })).status).toBe(404)
    expect((await app.request('/back-office/invoice-runs', { headers: auth('finance-analyst') })).status).toBe(200)
  })
})

describe('invoice run four-eyes → P9 dispatch (clean reconcile)', () => {
  class FakeP9 {
    instructed: string[] = []
    async issueInvoiceInstructions(run: { invoice_run_id: string }) {
      this.instructed.push(run.invoice_run_id)
      return { accepted: true }
    }
  }
  const finance: Principal = { subject: 'demo:finance-analyst', persona: 'finance-analyst', scopes: ['billing:write', 'billing:read'] }
  const approver: Principal = { subject: 'demo:super', persona: 'platform-super-admin', scopes: ['platform:superadmin'] }

  it('a clean record set → invoice run 202 + four-eyes; a different principal approves → dispatched_to_p9', async () => {
    const billingStore = new InMemoryBillingRecordStore()
    const invoiceStore = new InMemoryInvoiceRunStore()
    const audit = new InMemoryHighClassAuditSink()
    const p9 = new FakeP9()
    const approvals = new ApprovalsService(new InMemoryAuthAuditSink(), {
      operations: { [INVOICE_RUN_OPERATION]: makeInvoiceRunOperation({ invoiceStore, financialSystem: p9, audit }) }
    })
    const svc = new InvoicingService({ billingStore, invoiceStore, breakSink: { createMany: async () => [] }, approvals, audit })

    // seed a reconciled_clean record set
    const rec = await billingStore.create({ billing_period: PERIOD, ingested_by: 'demo:finance-analyst', integrity_hash: 'h', line_count: 100 })
    await billingStore.markReconciled(rec.record_set_id, 'reconciled_clean', 0, [])

    const approval = await svc.createInvoiceRun(finance, { billing_period: PERIOD, record_set_id: rec.record_set_id }, 't')
    expect(approval.state).toBe('pending')
    expect(approval.operation_type).toBe(INVOICE_RUN_OPERATION)

    // self-approval rejected (four-eyes), then a different principal approves
    await expect(approvals.approve(finance, approval.approval_request_id, 't')).rejects.toThrow()
    const approved = await approvals.approve(approver, approval.approval_request_id, 't')
    const exec = approved.execution_result as { dispatched: boolean; status: string }
    expect(exec.dispatched).toBe(true)
    expect(exec.status).toBe('dispatched_to_p9')
    expect(p9.instructed).toHaveLength(1)
    const run = await invoiceStore.list()
    expect(run.rows[0]!.status).toBe('dispatched_to_p9')
  })
})
