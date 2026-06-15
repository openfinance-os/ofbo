import { createHash } from 'node:crypto'
import type { FinancialSystemPort } from '@ofbo/ports'
import type {
  StoredBillingRecordSet,
  BillingRecordCreateInput,
  BillingRecordListQuery,
  BillingRecordPage,
  StoredInvoiceRun,
  InvoiceRunCreateInput,
  InvoiceRunListQuery,
  InvoiceRunPage,
  ReconciliationBreakCreateInput
} from '@ofbo/db'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import type { HighClassAuditSink } from '../high-class-audit.js'
import type { ApprovalRecord, GatedOperation } from '../approvals/service.js'
import { buildSimReconSources } from '../reconciliation/sources.js'
import { runThreeWayReconciliation } from '../reconciliation/engine.js'

/**
 * BACKOFFICE-73 — monthly TPP invoicing, reconcile BEFORE invoice (binding order):
 * (1) ingest the Nebras billing file (integrity hash + lineage); (2-3) reconcile
 * against the bank's own metering — variances create reconciliation_break records
 * (standard E1 workflow) + a Nebras billing query within the 30-day window;
 * (4) four-eyes invoice run, blocked (409) until reconciled and breaks cleared,
 * only clean lines flow to P9, disputed lines withheld; (5) settlement tracked.
 */

export const BILLING_READ_SCOPE = 'billing:read'
export const BILLING_WRITE_SCOPE = 'billing:write'
export const RECON_WRITE_SCOPE = 'finance:reconciliation:write'
export const INVOICE_RUN_OPERATION = 'tpp.invoice_run'
const FEE_VARIANCE_THRESHOLD = 1 // fils — reuse the E1 default

export class InvoicingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface BillingRecordStore {
  create(input: BillingRecordCreateInput, traceId: string): Promise<StoredBillingRecordSet>
  markReconciled(id: string, status: string, openBreakCount: number, queryRefs: string[], traceId: string): Promise<StoredBillingRecordSet | null>
  get(id: string): Promise<StoredBillingRecordSet | null>
  list(query?: BillingRecordListQuery): Promise<BillingRecordPage>
}

export interface InvoiceRunStore {
  create(input: InvoiceRunCreateInput, traceId: string): Promise<StoredInvoiceRun>
  markStatus(id: string, status: string, patch: { invoices?: unknown[] }, traceId: string): Promise<StoredInvoiceRun | null>
  get(id: string): Promise<StoredInvoiceRun | null>
  list(query?: InvoiceRunListQuery): Promise<InvoiceRunPage>
}

/** Minimal break-creation surface (reuses the E1 reconciliation_break store). */
export interface BreakSink {
  createMany(inputs: ReconciliationBreakCreateInput[], traceId: string): Promise<unknown[]>
}

export interface InvoiceApprovalRequester {
  requestApproval(principal: Principal, input: { operation_type: string; operation_payload: Record<string, unknown> }, traceId: string): Promise<ApprovalRecord>
}

/** BACKOFFICE-73 — the four-eyes invoice-run operation: on a second principal's
 *  approval, dispatch the instructions to P9 and mark the run dispatched. */
export function makeInvoiceRunOperation(deps: {
  invoiceStore: InvoiceRunStore
  financialSystem: Pick<FinancialSystemPort, 'issueInvoiceInstructions'>
  audit: HighClassAuditSink
}): GatedOperation {
  return {
    initiatorScope: BILLING_WRITE_SCOPE,
    approverScope: BILLING_WRITE_SCOPE,
    execute: async (payload) => {
      const invoiceRunId = String(payload.invoice_run_id)
      const traceId = String(payload.trace_id ?? 'unknown')
      const initiatedBy = String(payload.initiated_by ?? 'unknown')
      const run = await deps.invoiceStore.get(invoiceRunId)
      if (!run) return { invoice_run_id: invoiceRunId, dispatched: false }
      await deps.financialSystem.issueInvoiceInstructions({ invoice_run_id: invoiceRunId, instructions: run.invoices as Record<string, unknown>[] }, { trace_id: traceId })
      const updated = await deps.invoiceStore.markStatus(invoiceRunId, 'dispatched_to_p9', {}, traceId)
      await deps.audit.emit({
        event_type: 'tpp_invoice_run_dispatched',
        acting_principal: initiatedBy,
        acting_persona: 'system',
        scope_used: BILLING_WRITE_SCOPE,
        request_trace_id: traceId,
        request_body: { invoice_run_id: invoiceRunId, billing_period: run.billing_period, invoice_count: run.invoices.length, withheld_line_count: run.withheld_line_count, four_eyes_approved: true },
        response_status: 200
      })
      return { invoice_run_id: invoiceRunId, status: updated?.status ?? 'dispatched_to_p9', dispatched: true, invoice_count: run.invoices.length }
    }
  }
}

export interface InvoicingDeps {
  billingStore: BillingRecordStore
  invoiceStore: InvoiceRunStore
  breakSink: BreakSink
  approvals: InvoiceApprovalRequester
  audit: HighClassAuditSink
}

export class InvoicingService {
  constructor(private readonly deps: InvoicingDeps) {}

  async listRecordSets(principal: Principal, query: BillingRecordListQuery = {}): Promise<BillingRecordPage> {
    assertScope(principal, BILLING_READ_SCOPE)
    return this.deps.billingStore.list(query)
  }

  /** Step 1 — ingest the Nebras billing file: integrity hash + lineage + audit. */
  async ingest(principal: Principal, input: { billing_period: string; source_note?: string; fileBytes: Uint8Array }, traceId: string): Promise<StoredBillingRecordSet> {
    assertScope(principal, BILLING_WRITE_SCOPE)
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.billing_period)) {
      throw new InvoicingError('BACKOFFICE.INVALID_PERIOD', 'billing_period must be a calendar month YYYY-MM.', 400)
    }
    if (!input.fileBytes || input.fileBytes.byteLength === 0) {
      throw new InvoicingError('BACKOFFICE.INVALID_BODY', 'A non-empty billing-record file is required.', 400)
    }
    const integrity_hash = createHash('sha256').update(input.fileBytes).digest('hex')
    // line_count is the number of Nebras billing lines for the period (deterministic sim).
    const window = { start: `${input.billing_period}-01T00:00:00.000Z`, end: `${input.billing_period}-28T00:00:00.000Z` }
    const line_count = (await buildSimReconSources(input.billing_period).nebras.fetch(window)).length
    const recordSet = await this.deps.billingStore.create(
      { billing_period: input.billing_period, ingested_by: principal.subject, source_note: input.source_note ?? null, integrity_hash, line_count },
      traceId
    )
    await this.deps.audit.emit({
      event_type: 'tpp_billing_records_ingested',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: BILLING_WRITE_SCOPE,
      request_trace_id: traceId,
      request_body: { record_set_id: recordSet.record_set_id, billing_period: input.billing_period, integrity_hash, line_count },
      response_status: 201,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })
    return recordSet
  }

  /** Steps 2-3 — reconcile the billing file against the bank's own metering. Nebras
   *  figures are never blindly trusted: variances create reconciliation_break rows
   *  + a Nebras billing query ref (30-day dispute window). */
  async reconcile(principal: Principal, recordSetId: string, traceId: string): Promise<StoredBillingRecordSet> {
    assertScope(principal, RECON_WRITE_SCOPE)
    const recordSet = await this.deps.billingStore.get(recordSetId)
    if (!recordSet) throw new InvoicingError('BACKOFFICE.RECORD_SET_NOT_FOUND', `No billing record set ${recordSetId}.`, 404)
    if (recordSet.status !== 'ingested') throw new InvoicingError('BACKOFFICE.ALREADY_RECONCILED', `record set is ${recordSet.status}`, 409)

    // Reuse the E1 three-way match for the period: unmatched billing lines are variances.
    const bundle = buildSimReconSources(recordSet.billing_period)
    const result = await runThreeWayReconciliation(bundle, { start: `${recordSet.billing_period}-01T00:00:00.000Z`, end: `${recordSet.billing_period}-28T00:00:00.000Z` }, { openDisputeRefs: bundle.openDisputeRefs })
    const variances = result.lines.filter((l) => l.classification === 'unmatched' && (l.variance === null || Math.abs(l.variance.amount) > FEE_VARIANCE_THRESHOLD))

    const runId = `bill-${recordSet.billing_period}-${recordSet.record_set_id.slice(0, 8)}`
    const queryRefs: string[] = []
    if (variances.length > 0) {
      await this.deps.breakSink.createMany(
        variances.map((l) => ({
          run_id: runId,
          client_id: l.client_id,
          line_type: l.line_type,
          variance_amount: l.variance,
          variance_count: l.variance ? null : 1,
          source_a_ref: l.source_a_ref,
          source_b_ref: l.source_b_ref,
          source_c_ref: l.source_c_ref
        })),
        traceId
      )
      // open a Nebras billing query per break within the 30-day dispute window
      variances.forEach((l) => queryRefs.push(`nebras-query-${l.line_ref}`))
    }
    const status = variances.length > 0 ? 'reconciled_with_breaks' : 'reconciled_clean'
    const updated = await this.deps.billingStore.markReconciled(recordSetId, status, variances.length, queryRefs, traceId)
    if (!updated) throw new InvoicingError('BACKOFFICE.RECORD_SET_NOT_FOUND', `No billing record set ${recordSetId}.`, 404)

    await this.deps.audit.emit({
      event_type: 'tpp_billing_reconciled',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: RECON_WRITE_SCOPE,
      request_trace_id: traceId,
      request_body: { record_set_id: recordSetId, status, open_break_count: variances.length, nebras_billing_query_refs: queryRefs },
      response_status: 202,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })
    return updated
  }

  async listInvoiceRuns(principal: Principal, query: InvoiceRunListQuery = {}): Promise<InvoiceRunPage> {
    assertScope(principal, BILLING_READ_SCOPE)
    return this.deps.invoiceStore.list(query)
  }

  async getInvoiceRun(principal: Principal, id: string): Promise<StoredInvoiceRun | null> {
    assertScope(principal, BILLING_READ_SCOPE)
    return this.deps.invoiceStore.get(id)
  }

  /** Step 4 — create a four-eyes invoice run. 409 unless the record set is
   *  reconciled_clean or reconciled_with_breaks with all breaks cleared. Only clean
   *  lines flow into instructions; disputed lines are withheld. */
  async createInvoiceRun(principal: Principal, input: { billing_period: string; record_set_id: string }, traceId: string): Promise<ApprovalRecord> {
    assertScope(principal, BILLING_WRITE_SCOPE)
    if (!input.billing_period || !input.record_set_id) throw new InvoicingError('BACKOFFICE.INVALID_BODY', 'billing_period and record_set_id are required.', 400)
    const recordSet = await this.deps.billingStore.get(input.record_set_id)
    if (!recordSet) throw new InvoicingError('BACKOFFICE.RECORD_SET_NOT_FOUND', `No billing record set ${input.record_set_id}.`, 404)
    if (recordSet.status === 'ingested' || recordSet.status === 'reconciling') {
      throw new InvoicingError('BACKOFFICE.NOT_RECONCILED', 'reconcile the billing records before invoicing (reconcile-before-invoice).', 409)
    }
    if (recordSet.status === 'reconciled_with_breaks' && recordSet.open_break_count > 0) {
      throw new InvoicingError('BACKOFFICE.UNRESOLVED_BREAKS', `${recordSet.open_break_count} unresolved break(s) block the invoice run.`, 409)
    }

    // Build instructions for clean lines; disputed lines (the breaks) are withheld.
    const withheld_line_count = recordSet.open_break_count
    const invoiceable = Math.max(recordSet.line_count - withheld_line_count, 0)
    const run = await this.deps.invoiceStore.create(
      {
        billing_period: input.billing_period,
        record_set_id: input.record_set_id,
        status: 'pending_approval',
        invoices: [{ summary: 'clean-lines', invoiceable_line_count: invoiceable }],
        withheld_line_count
      },
      traceId
    )
    const approval = await this.deps.approvals.requestApproval(
      principal,
      { operation_type: INVOICE_RUN_OPERATION, operation_payload: { invoice_run_id: run.invoice_run_id, billing_period: input.billing_period, initiated_by: principal.subject, trace_id: traceId } },
      traceId
    )
    // link the approval to the run
    await this.deps.invoiceStore.markStatus(run.invoice_run_id, 'pending_approval', {}, traceId)
    await this.deps.audit.emit({
      event_type: 'tpp_invoice_run_created',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: BILLING_WRITE_SCOPE,
      request_trace_id: traceId,
      request_body: { invoice_run_id: run.invoice_run_id, billing_period: input.billing_period, record_set_id: input.record_set_id, withheld_line_count, approval_request_id: approval.approval_request_id },
      response_status: 202,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })
    return approval
  }
}

/** No-database defaults (tests / local dev). */
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
