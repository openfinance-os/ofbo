import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { PayableCloseService, makePayableCloseOperation } from '../src/billing/payable-close.js'

/**
 * BILL-15 criterion 3, end to end — **a disputed line cannot reach an approved payable**.
 *
 * This is the criterion BILL-15 could only half-build. `openPayableBreaks` was its gate query and was
 * tested tenant-scoped, but the refusal that query feeds lives in BILL-16's close, so the blocked
 * PATH could not be walked until both halves existed. Both now do.
 *
 * The path has four steps, and the test asserts each one refuses in its own right rather than relying
 * on the first to protect the rest:
 *
 *   1. an unresolved material break makes the close REQUEST refuse (409);
 *   2. it makes the close EXECUTION refuse too — approval is a separate act up to two business hours
 *      later, so a break raised in between must still stop the close;
 *   3. with no close, a payable has no approval, so DISPATCH refuses (409);
 *   4. resolve the break and the same period closes and dispatches cleanly — the gate has to be able
 *      to say yes, or it is not a gate, it is a wall.
 */

const PERIOD = '2026-06'
const PAYABLE = '22222222-2222-4222-8222-222222222222'

function headers(persona = 'finance-analyst', extra: Record<string, string> = {}) {
  return {
    authorization: `Bearer demo-token:${persona}`,
    'x-fapi-interaction-id': 'blocked-path-0001',
    ...extra
  }
}

const BREAK = { lineRef: 'NEB-INV-2026-06|SI-CORP-PAY', breakType: 'rate_variance' }

/**
 * A close store whose open breaks can be cleared mid-test, standing in for the E1 workflow: a payable
 * break leaves this gate when the `reconciliation_break` it was escalated as reaches a resolved
 * status. That escalation is what BILL-15's reconcile service now writes.
 */
function mutableCloseStore(initial: Array<{ lineRef: string; breakType: string }>) {
  let open = [...initial]
  return {
    store: {
      openPayableBreaks: vi.fn(async () => open),
      saveClose: vi.fn(async () => ({ closeId: 'close-1', created: true }))
    },
    resolveAll: () => { open = [] }
  }
}

describe('BILL-15 criterion 3 — the blocked path, end to end', () => {
  it('1. REFUSES the close request while the break is unresolved', async () => {
    const { store } = mutableCloseStore([BREAK])
    const res = await createApp({ payableCloseStore: store } as never).request(
      `/back-office/billing/cost-periods/${PERIOD}:close`,
      { method: 'POST', headers: headers('finance-analyst', { 'idempotency-key': 'bp-1' }) }
    )
    expect(res.status).toBe(409)
    const body = await res.json() as { error: { code: string; message: string } }
    expect(body.error.code).toBe('BACKOFFICE.UNRESOLVED_PAYABLE_BREAKS')
    expect(body.error.message).toContain(BREAK.lineRef)
    expect(store.saveClose).not.toHaveBeenCalled()
  })

  it('2. REFUSES the close EXECUTION for a break raised after the request was approved', async () => {
    // The window between request and approval is the interesting one. The period was clear when the
    // close was asked for; a break landed before the second principal approved. Checking only at
    // request time would close the period against state that was true then and is not true now.
    const openLater: Array<{ lineRef: string; breakType: string }> = []
    const store = {
      openPayableBreaks: vi.fn(async () => openLater),
      saveClose: vi.fn(async () => ({ closeId: 'close-1', created: true }))
    }
    const service = new PayableCloseService({
      store: store as never,
      approvals: { request: vi.fn(async () => ({ approval_request_id: 'apr-1', state: 'pending' })) } as never,
      audit: { emit: vi.fn(async () => undefined) } as never
    })

    // Requested while clear — accepted.
    await expect(service.requestClose(
      { subject: 'a@bank', persona: 'finance-analyst', scopes: ['finance:reconciliation:write'] } as never,
      PERIOD, 'trace-1'
    )).resolves.toMatchObject({ state: 'pending' })

    // A break lands in the approval window.
    openLater.push(BREAK)

    const operation = makePayableCloseOperation(service)
    await expect(operation.execute({ period: PERIOD, trace_id: 'trace-1' }, {
      approver: 'b@bank',
      approverPersona: 'finance-analyst',
      initiator: 'a@bank',
      approvalRequestId: 'apr-1',
      approverIsSuperadmin: false
    })).rejects.toMatchObject({ code: 'BACKOFFICE.UNRESOLVED_PAYABLE_BREAKS' })

    expect(store.saveClose).not.toHaveBeenCalled()
  })

  it('3. REFUSES the dispatch, because with no close the payable carries no approval', async () => {
    const dispatchStore = {
      approvedPayable: vi.fn(async () => ({
        payableId: PAYABLE,
        period: PERIOD,
        counterpartyId: 'nebras',
        counterpartyType: 'nebras' as const,
        amountFils: 105_000,
        currency: 'AED',
        approvalRequestId: null,
        documentReference: 'NEB-INV-2026-06'
      })),
      recordDispatch: vi.fn()
    }
    const res = await createApp({
      payableCloseStore: mutableCloseStore([BREAK]).store,
      payableDispatchStore: dispatchStore
    } as never).request(`/back-office/billing/payables/${PAYABLE}:dispatch`,
      { method: 'POST', headers: headers('finance-analyst', { 'idempotency-key': 'bp-3' }) })

    expect(res.status).toBe(409)
    const body = await res.json() as { error: { code: string; message: string } }
    expect(body.error.code).toBe('BACKOFFICE.PAYABLE_NOT_APPROVED')
    expect(body.error.message).toContain('authorises honouring the scheme direct debit')
    // Nothing reached the financial system, and nothing was written.
    expect(dispatchStore.recordDispatch).not.toHaveBeenCalled()
  })

  it('4. ACCEPTS the close once the break resolves — the gate can say yes', async () => {
    // A gate that can only refuse is a wall. The escalated E1 break reaching a resolved status is
    // what lets the diff line leave `openPayableBreaks`, which is why BILL-15's reconcile service now
    // raises real E1 breaks instead of writing diff lines with a null break id.
    const { store, resolveAll } = mutableCloseStore([BREAK])
    const app = createApp({ payableCloseStore: store } as never)

    const blocked = await app.request(`/back-office/billing/cost-periods/${PERIOD}:close`,
      { method: 'POST', headers: headers('finance-analyst', { 'idempotency-key': 'bp-4a' }) })
    expect(blocked.status).toBe(409)

    resolveAll()

    const accepted = await app.request(`/back-office/billing/cost-periods/${PERIOD}:close`,
      { method: 'POST', headers: headers('finance-analyst', { 'idempotency-key': 'bp-4b' }) })
    expect(accepted.status).toBe(202)
    const body = await accepted.json() as { data: { approval_request_id: string } }
    expect(body.data.approval_request_id).toBeTruthy()
  })
})

describe('BILL-15 criterion 6(a) — payable breaks reach the E1 queue', () => {
  it('escalates a material break and stamps its id onto the diff line', async () => {
    const { TppCostReconcileService } = await import('../src/billing/tpp-cost-reconcile.js')
    const saved: Array<Record<string, unknown>> = []
    const createMany = vi.fn(async (inputs: Array<Record<string, unknown>>) =>
      inputs.map((_, i) => ({ id: `brk-${i + 1}` })))

    const service = new TppCostReconcileService({
      store: {
        documentPeriod: async () => PERIOD,
        reconcilableDocumentsForPeriod: async () => [{
          documentId: 'doc-1',
          documentType: 'nebras_tax_invoice',
          issuerId: 'nebras',
          documentReference: 'NEB-INV-2026-06',
          billingPeriod: PERIOD,
          issuedAt: '2026-07-05T00:00:00.000Z',
          receivedAt: '2026-07-05T00:00:00.000Z',
          lines: [{
            lineRef: 'L1',
            sourceCategory: 'Corporate Payment',
            feeClass: 'payment.corporate',
            mapped: true,
            costRecipientType: 'nebras',
            costRecipientId: 'nebras',
            units: 10,
            unitPriceMilliFils: 50_000,
            actualNetMilliFils: 500_000,
            vatMilliFils: 25_000,
            actualGrossMilliFils: 525_000
          }]
        }],
        // No expected line for the document's category -> an unexpected-charge break, which is
        // material, which is what must reach the queue.
        latestStatement: async () => ({
          id: 'stmt-1',
          statement: {
            period: PERIOD,
            currency: 'AED',
            generatedAt: '2026-07-03T00:00:00.000Z',
            lines: [],
            totalNetMilliFils: 0,
            totalVatMilliFils: 0,
            totalGrossMilliFils: 0
          }
        }),
        saveReconciliation: async (input: Record<string, unknown>) => {
          saved.push(input)
          return { reconciliationIds: ['rec-1'], created: true }
        }
      } as never,
      breakEscalation: { countForRun: async () => 0, createMany } as never,
      audit: { emit: vi.fn(async () => undefined) } as never
    })

    await service.reconcile(
      { subject: 'a@bank', persona: 'finance-analyst', scopes: ['finance:reconciliation:write'] } as never,
      'doc-1', 'idem-esc-1', 'trace-esc'
    )

    expect(createMany).toHaveBeenCalledTimes(1)
    const raised = createMany.mock.calls[0]![0] as Array<Record<string, unknown>>
    expect(raised.length).toBeGreaterThan(0)
    // E1 breaks carry Money, not milli-fils — they are read beside receivable breaks.
    expect(raised[0]!.variance_amount).toMatchObject({ currency: 'AED' })
    // There is no source C on the payable side: nobody re-bills us.
    expect(raised[0]!.source_c_ref).toBeNull()

    const persisted = saved[0]!.result as { breaks: Array<{ reconciliationBreakId?: string }> }
    expect(persisted.breaks.some((b) => b.reconciliationBreakId === 'brk-1')).toBe(true)
  })

  it('does NOT raise a second set of breaks when the same run is replayed', async () => {
    const { TppCostReconcileService } = await import('../src/billing/tpp-cost-reconcile.js')
    const createMany = vi.fn(async () => [])
    const service = new TppCostReconcileService({
      store: {
        documentPeriod: async () => PERIOD,
        reconcilableDocumentsForPeriod: async () => [{
          documentId: 'doc-1',
          documentType: 'nebras_tax_invoice',
          issuerId: 'nebras',
          documentReference: 'NEB-INV-2026-06',
          billingPeriod: PERIOD,
          issuedAt: '2026-07-05T00:00:00.000Z',
          receivedAt: '2026-07-05T00:00:00.000Z',
          lines: [{
            lineRef: 'L1',
            sourceCategory: 'Corporate Payment',
            feeClass: 'payment.corporate',
            mapped: true,
            costRecipientType: 'nebras',
            costRecipientId: 'nebras',
            units: 10,
            unitPriceMilliFils: 50_000,
            actualNetMilliFils: 500_000,
            vatMilliFils: 25_000,
            actualGrossMilliFils: 525_000
          }]
        }],
        latestStatement: async () => ({
          id: 'stmt-1',
          statement: {
            period: PERIOD, currency: 'AED', generatedAt: '2026-07-03T00:00:00.000Z',
            lines: [], totalNetMilliFils: 0, totalVatMilliFils: 0, totalGrossMilliFils: 0
          }
        }),
        saveReconciliation: async () => ({ reconciliationIds: ['rec-1'], created: false })
      } as never,
      // Already raised for this run — a retried scheduled job must not double the desk's queue.
      breakEscalation: { countForRun: async () => 3, createMany } as never,
      audit: { emit: vi.fn(async () => undefined) } as never
    })

    await service.reconcile(
      { subject: 'a@bank', persona: 'finance-analyst', scopes: ['finance:reconciliation:write'] } as never,
      'doc-1', 'idem-esc-1', 'trace-esc'
    )
    expect(createMany).not.toHaveBeenCalled()
  })
})
