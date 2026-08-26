// CODE-02 — in-memory store(s) lifted verbatim out of services/bff/src/tpp-billing/invoicing.ts.
// Behaviour unchanged; see ./README.md for why they live outside src/.
import type { BillingRecordStore, InvoiceRunStore } from '../src/tpp-billing/invoicing.js'
import type {
  StoredBillingRecordSet,
  BillingRecordCreateInput,
  BillingRecordListQuery,
  BillingRecordPage,
  StoredInvoiceRun,
  InvoiceRunCreateInput,
  InvoiceRunListQuery,
  InvoiceRunPage
} from '@ofbo/db'

export class InMemoryBillingRecordStore implements BillingRecordStore {
  private readonly rows: StoredBillingRecordSet[] = []
  async create(input: BillingRecordCreateInput): Promise<StoredBillingRecordSet> {
    const now = new Date().toISOString()
    const r: StoredBillingRecordSet = {
      record_set_id: crypto.randomUUID(),
      billing_period: input.billing_period,
      ingested_at: now,
      ingested_by: input.ingested_by,
      source_note: input.source_note ?? null,
      integrity_hash: input.integrity_hash,
      line_count: input.line_count,
      status: 'ingested',
      open_break_count: 0,
      nebras_billing_query_refs: []
    }
    this.rows.unshift(r)
    return r
  }
  async markReconciled(id: string, status: string, openBreakCount: number, queryRefs: string[]): Promise<StoredBillingRecordSet | null> {
    const r = this.rows.find((x) => x.record_set_id === id)
    if (!r) return null
    r.status = status
    r.open_break_count = openBreakCount
    r.nebras_billing_query_refs = queryRefs
    return r
  }
  async get(id: string): Promise<StoredBillingRecordSet | null> {
    return this.rows.find((x) => x.record_set_id === id) ?? null
  }
  async list(query: BillingRecordListQuery = {}): Promise<BillingRecordPage> {
    let rows = this.rows
    if (query.billing_period) rows = rows.filter((r) => r.billing_period === query.billing_period)
    return { rows: rows.slice(0, Math.min(Math.max(query.limit ?? 50, 1), 200)), next_cursor: null }
  }
}

export class InMemoryInvoiceRunStore implements InvoiceRunStore {
  private readonly rows: StoredInvoiceRun[] = []
  async create(input: InvoiceRunCreateInput): Promise<StoredInvoiceRun> {
    const r: StoredInvoiceRun = {
      invoice_run_id: crypto.randomUUID(),
      billing_period: input.billing_period,
      record_set_id: input.record_set_id,
      status: input.status ?? 'pending_approval',
      approval_id: input.approval_id ?? null,
      invoices: input.invoices ?? [],
      withheld_line_count: input.withheld_line_count ?? 0,
      net_settlement_offset: input.net_settlement_offset ?? null
    }
    this.rows.unshift(r)
    return r
  }
  async markStatus(id: string, status: string, patch: { invoices?: unknown[] }): Promise<StoredInvoiceRun | null> {
    const r = this.rows.find((x) => x.invoice_run_id === id)
    if (!r) return null
    r.status = status
    if (patch.invoices) r.invoices = patch.invoices
    return r
  }
  async get(id: string): Promise<StoredInvoiceRun | null> {
    return this.rows.find((x) => x.invoice_run_id === id) ?? null
  }
  async list(query: InvoiceRunListQuery = {}): Promise<InvoiceRunPage> {
    return { rows: this.rows.slice(0, Math.min(Math.max(query.limit ?? 50, 1), 200)), next_cursor: null }
  }
}
