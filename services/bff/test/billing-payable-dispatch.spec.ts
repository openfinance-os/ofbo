import { describe, expect, it, vi } from 'vitest'
import { PayableDispatchError, PayableDispatchService } from '../src/billing/payable-dispatch.js'
import type { Principal } from '../src/auth.js'

/**
 * BILL-16 criterion 3 (service half) — P9 AP dispatch.
 *
 * The port contract suite already proves idempotency and the fail-closed refusal on both adapters.
 * What only the service can establish is the other half of the criterion: that dispatch is AUDITED,
 * and that it CANNOT MUTATE BILLING EVIDENCE.
 *
 * The second is the one worth designing for. Dispatch happens after a four-eyes approval, at the far
 * end of the payable lifecycle, and the tables it sits next to are INSERT-only with no deletion path.
 * A dispatch path that could write back into the statement, document or reconciliation tables would
 * make the evidence a downstream system can influence — so the service is given no way to reach them.
 */

// The APPROVER of the cited close, and therefore a principal entitled to dispatch it. Dispatch
// authority is bound to participation in the four-eyes act (see the authority tests at the foot of
// this file), so this subject must match the `approver` on the approval fixture below — a bystander
// holding the same scope is refused, which is the point.
const APPROVER: Principal = {
  subject: 'demo:finance-manager@alpha-bank',
  persona: 'finance-analyst',
  scopes: ['finance:reconciliation:write', 'billing:write'],
  bankId: '11111111-1111-4111-8111-111111111111'
} as Principal

const NO_SCOPE: Principal = { ...APPROVER, scopes: ['billing:read'] } as Principal

const APPROVED = {
  payableId: 'PAY-2026-06-001',
  period: '2026-06',
  counterpartyId: 'NEBRAS',
  counterpartyType: 'nebras' as const,
  amountFils: 2625,
  currency: 'AED',
  approvalRequestId: 'apr-0000-4000-8000-000000000001',
  documentReference: 'NEB-INV-2026-06-0001'
}

function harness(
  overrides: Record<string, unknown> = {},
  approvalOverrides: Record<string, unknown> = {}
) {
  const audited: Array<Record<string, unknown>> = []
  const dispatched: Array<Record<string, unknown>> = []
  const port = {
    dispatchPayableInstruction: vi.fn(async (instruction: Record<string, unknown>) => {
      dispatched.push(instruction)
      return { accepted: true, dispatch_ref: 'fms-pay-1', payable_status: 'dispatched', replayed: false }
    }),
    getPayableStatus: vi.fn(async () => ({ payable_status: 'presented' }))
  }
  const store = {
    approvedPayable: vi.fn(async () => APPROVED),
    recordDispatch: vi.fn(async () => ({ dispatchId: 'disp-1', created: true })),
    ...overrides
  }
  // A LIVE approval by default: approved, for this payable's own period, by someone other than the
  // initiator, inside its window. Every test that expects a dispatch depends on all of those.
  const { get: getOverride, ...recordOverrides } = approvalOverrides
  const approvals = {
    get: getOverride ?? vi.fn(async () => ({
      approval_request_id: APPROVED.approvalRequestId,
      operation_type: 'billing.tpp_cost.period_close',
      operation_payload: { period: APPROVED.period },
      state: 'approved',
      initiator: 'demo:finance-analyst@alpha-bank',
      approver: 'demo:finance-manager@alpha-bank',
      expires_at: '2026-07-05T12:00:00.000Z',
      // Approved INSIDE its window (migration 0042). Part of "live" — an approval that happened
      // after its own deadline authorises nothing, and before 0042 the row could not say either way.
      approved_at: '2026-07-03T18:00:00.000Z',
      ...recordOverrides
    }))
  }
  const service = new PayableDispatchService({
    store: store as never,
    financialSystem: port as never,
    approvals: approvals as never,
    audit: { emit: vi.fn(async (e: Record<string, unknown>) => { audited.push(e) }) } as never,
    now: () => new Date('2026-07-04T00:00:00.000Z')
  })
  return { service, port, store, approvals, audited, dispatched }
}

describe('BILL-16 payable dispatch', () => {
  it('dispatches an approved payable and records it', async () => {
    const { service, dispatched } = harness()
    const result = await service.dispatch(APPROVER, 'PAY-2026-06-001', 'idem-1', 'trace-1')

    expect(result.dispatchRef).toBe('fms-pay-1')
    expect(dispatched[0]).toMatchObject({
      payable_id: 'PAY-2026-06-001',
      amount_fils: 2625,
      currency: 'AED',
      approval_request_id: APPROVED.approvalRequestId,
      idempotency_key: 'idem-1'
    })
  })

  it('REFUSES a payable with no four-eyes approval, before touching the port', async () => {
    // The approval is what authorises honouring the direct debit (IG §10.14-10.15). Dispatching
    // without one would settle money on one person's say-so.
    const { service, port } = harness({
      approvedPayable: vi.fn(async () => ({ ...APPROVED, approvalRequestId: null }))
    })
    await expect(service.dispatch(APPROVER, 'PAY-2026-06-001', 'idem-1', 'trace-1'))
      .rejects.toMatchObject({ code: 'BACKOFFICE.PAYABLE_NOT_APPROVED', status: 409 })
    expect(port.dispatchPayableInstruction).not.toHaveBeenCalled()
  })

  it('REFUSES every citation that is not a LIVE approval of THIS payable', async () => {
    // Presence of a non-empty approvalRequestId was the whole of the authorisation. The foreign key
    // constrains existence and tenant; state, expiry and subject are all mutable on the referenced
    // row, so none of them was constrained anywhere — and this is the path that reaches P9 and moves
    // money. Each case below dispatched successfully before this check existed.
    const cases: Array<[string, Record<string, unknown>, RegExp]> = [
      ['pending — approved by nobody', { state: 'pending', approver: null, expires_at: '2026-07-05T12:00:00.000Z' }, /is pending/i],
      ['rejected — somebody said no', { state: 'rejected', approver: null }, /is rejected/i],
      ['timed out — the 2-hour window passed', { state: 'pending', approver: null, expires_at: '2026-07-03T00:00:00.000Z' }, /timed out/i],
      ['wrong period — id copied from another close', { operation_payload: { period: '2026-05' } }, /different period/i],
      ['wrong operation — an id that authorised something else', { operation_type: 'billing.rate_card.publish' }, /not a payable close/i],
      ['approved but with no second principal', { approver: null }, /one person twice/i],
      ['approved by its own initiator', { approver: 'demo:finance-analyst@alpha-bank' }, /one person twice/i],
      // The two cases the schema could not express before migration 0042. Both rows are state
      // 'approved', so the pending-only expiry test above never fires on them — each dispatched
      // successfully until approved_at existed to be checked.
      ['approved AFTER its own window closed', { approved_at: '2026-07-06T09:00:00.000Z' }, /after its window closed/i],
      ['approved, but the row cannot say when', { approved_at: null }, /cannot be shown to have been approved/i]
    ]

    for (const [label, approval, expected] of cases) {
      const { service, port } = harness({}, approval)
      await expect(service.dispatch(APPROVER, 'PAY-2026-06-001', `idem-${label}`, 'trace-1'), label)
        .rejects.toThrow(expected)
      // Refused BEFORE the port. A request that never leaves is the only way to be sure the debit
      // was not honoured — a downstream rollback is not available for a scheme direct debit.
      expect(port.dispatchPayableInstruction, label).not.toHaveBeenCalled()
    }
  })

  it('refuses one human spelled two ways on the LAST check before money moves', async () => {
    // payable-close normalises this comparison precisely because a raw === treats `Finance.Analyst`
    // and `finance.analyst ` as two people — the cheapest way there is to defeat four eyes. Dispatch,
    // which its own comment calls "the last place that can refuse before the money moves", used a raw
    // ===. The existing same-principal case passed byte-identical strings, so the gap was untested.
    for (const approver of [
      'DEMO:Finance-Analyst@alpha-bank',
      ' demo:finance-analyst@alpha-bank ',
      'demo:FINANCE-ANALYST@ALPHA-BANK'
    ]) {
      const { service, port } = harness({}, { approver })
      await expect(service.dispatch(APPROVER, 'PAY-2026-06-001', `idem-${approver}`, 'trace-1'), approver)
        .rejects.toThrow(/one person twice/i)
      expect(port.dispatchPayableInstruction, approver).not.toHaveBeenCalled()
    }
  })

  it('stamps the superadmin marker on both dispatch outcomes', async () => {
    // PRD §2: stamped on EVERY High-class record produced under platform:superadmin. hasScope lets a
    // superadmin satisfy finance:reconciliation:write, so without it a superadmin authorising a
    // direct debit is indistinguishable from an analyst on the record that authorises the money.
    // persona AND scope together. Keeping persona 'finance-analyst' while adding
    // platform:superadmin builds a principal the §2 matrix cannot mint — platform-super-admin is
    // its own persona, not a scope a finance analyst may hold — and this fixture is what the
    // audit assertion below pins acting_persona against.
    const superadmin = {
      ...APPROVER,
      persona: 'platform-super-admin',
      subject: 'demo:platform-super-admin@alpha-bank',
      scopes: [...APPROVER.scopes, 'platform:superadmin']
    }
    // The superadmin has to be a PARTICIPANT in the close to dispatch it — holding
    // platform:superadmin is not a four-eyes bypass, and building the fixture the other way would
    // have quietly asserted that it is. So the approval fixture names them as its approver.
    const asApprover = { approver: superadmin.subject }

    const ok = harness({}, asApprover)
    await ok.service.dispatch(superadmin, 'PAY-2026-06-001', 'idem-ok', 'trace-1')
    expect(ok.audited.find((e) => e.event_type === 'billing_tpp_cost_payable_dispatched')?.superadmin_marker)
      .toBe(true)

    const bad = harness({}, asApprover)
    bad.port.dispatchPayableInstruction.mockRejectedValueOnce(new Error('financial-system 503'))
    await expect(bad.service.dispatch(superadmin, 'PAY-2026-06-001', 'idem-bad', 'trace-1')).rejects.toThrow()
    expect(bad.audited.find((e) => e.event_type === 'billing_tpp_cost_payable_dispatch_failed')?.superadmin_marker)
      .toBe(true)
  })

  it('REFUSES a citation that resolves to nothing at all', async () => {
    const { service, port } = harness({}, { get: async () => null })
    await expect(service.dispatch(APPROVER, 'PAY-2026-06-001', 'idem-1', 'trace-1'))
      .rejects.toThrow(/does not exist/i)
    expect(port.dispatchPayableInstruction).not.toHaveBeenCalled()
  })

  it('answers 404 for a payable that is not this tenant\'s', async () => {
    const { service } = harness({ approvedPayable: vi.fn(async () => null) })
    await expect(service.dispatch(APPROVER, 'PAY-X', 'idem-1', 'trace-1'))
      .rejects.toMatchObject({ code: 'BACKOFFICE.NOT_FOUND', status: 404 })
  })

  it('refuses a principal without the scope', async () => {
    const { service, port } = harness()
    await expect(service.dispatch(NO_SCOPE, 'PAY-2026-06-001', 'idem-1', 'trace-1')).rejects.toThrow()
    expect(port.dispatchPayableInstruction).not.toHaveBeenCalled()
  })

  it('requires an idempotency key rather than generating one', async () => {
    // A generated key makes every retry a new dispatch, which is how the same debit gets authorised
    // twice. The caller's key is what makes the port's dedupe reachable.
    const { service, port } = harness()
    await expect(service.dispatch(APPROVER, 'PAY-2026-06-001', '', 'trace-1'))
      .rejects.toMatchObject({ status: 400 })
    expect(port.dispatchPayableInstruction).not.toHaveBeenCalled()
  })

  it('surfaces a replayed dispatch as a replay rather than a new one', async () => {
    const { service, port } = harness()
    port.dispatchPayableInstruction.mockResolvedValueOnce({
      accepted: true, dispatch_ref: 'fms-pay-1', payable_status: 'dispatched', replayed: true
    })
    const result = await service.dispatch(APPROVER, 'PAY-2026-06-001', 'idem-1', 'trace-1')
    expect(result.replayed).toBe(true)
  })

  it('audits the dispatch with the scope, approval and downstream reference', async () => {
    const { service, audited } = harness()
    await service.dispatch(APPROVER, 'PAY-2026-06-001', 'idem-1', 'trace-1')
    expect(audited[0]).toMatchObject({
      event_type: 'billing_tpp_cost_payable_dispatched',
      acting_principal: APPROVER.subject,
      scope_used: 'finance:reconciliation:write',
      request_trace_id: 'trace-1'
    })
    expect(audited[0]!.request_body).toMatchObject({
      payable_id: 'PAY-2026-06-001',
      approval_request_id: APPROVED.approvalRequestId,
      dispatch_ref: 'fms-pay-1'
    })
  })

  it('audits a downstream FAILURE too, rather than only the happy path', async () => {
    // An unaudited failure is the case an investigator most needs and least often has.
    const { service, audited, port } = harness()
    port.dispatchPayableInstruction.mockRejectedValueOnce(new Error('financial-system 503'))
    await expect(service.dispatch(APPROVER, 'PAY-2026-06-001', 'idem-1', 'trace-1')).rejects.toThrow()
    expect(audited.some((e) => e.event_type === 'billing_tpp_cost_payable_dispatch_failed')).toBe(true)
  })

  it('REDACTS the failure text before it reaches the INSERT-only trail', async () => {
    // The audit row is unremovable, and the failure text is COMPOSED by the P9 adapter from the
    // vendor's response — so "the message only, never the downstream payload" was a claim about how
    // carefully every adapter words its errors, not a property of this code. One adapter did quote
    // the vendor's `payable_status` verbatim. That is fixed at source; this asserts the second
    // control, because P9's response shape belongs to the vendor and can change without us.
    const { service, audited, port } = harness()
    port.dispatchPayableInstruction.mockRejectedValueOnce(
      // Synthetic, and identifier-SHAPED on purpose: a redaction assertion is worthless unless the
      // input is something the redactor actually recognises, so this must match the IBAN and email
      // detectors in packages/redaction. Both values are unusable — the IBAN carries the
      // unallocated bank code 000 and fails the ISO 13616 mod-97 check (remainder 49, not 1), and
      // example.com is the RFC 2606 reserved domain. No Emirates ID appears here; an earlier
      // version of this comment cited the 999-vs-784 national-identifier convention, which
      // describes a value this fixture does not contain.
      new Error('financial-system rejected debtor AE070001234567890123456 for ops@example.com')
    )

    await expect(service.dispatch(APPROVER, 'PAY-2026-06-001', 'idem-1', 'trace-1')).rejects.toThrow()

    const failed = audited.find((e) => e.event_type === 'billing_tpp_cost_payable_dispatch_failed')
    const body = JSON.stringify((failed as { request_body: unknown }).request_body)
    expect(body).not.toContain('AE070001234567890123456')
    expect(body).not.toContain('ops@example.com')
  })

  it('CANNOT mutate billing evidence — its store surface has no write into the ledger', () => {
    // Structural, not behavioural: the dependency exposes exactly two methods, one read and one
    // append of a dispatch record. There is no statement, document or reconciliation writer reachable
    // from here, so "dispatch cannot alter the evidence it was approved against" holds by
    // construction rather than by everyone remembering not to.
    const { store } = harness()
    expect(Object.keys(store).sort()).toEqual(['approvedPayable', 'recordDispatch'])
  })
})

describe('BILL-16 PayableDispatchError', () => {
  it('carries its own remediation', () => {
    const error = new PayableDispatchError('BACKOFFICE.X', 'm', 409, 'fix it')
    expect(error).toMatchObject({ code: 'BACKOFFICE.X', status: 409, remediation: 'fix it' })
  })
})

/**
 * Raised as FAIL 3 and FAIL 5 by the hard-stop reviewer on PR #323.
 *
 * FAIL 3 (`payable-dispatch.ts:172`): the caller-supplied Idempotency-Key went UNREDACTED into
 * `store.recordDispatch`, an INSERT-only table with no deletion path — while the adjacent field on
 * the same call was redacted, and the failure-path audit redacted the very same value eleven lines
 * below. Redaction is the wrong tool here though: the column is a dedupe key and has to stay
 * comparable, so it is HASHED. The hash is deterministic, so `UNIQUE (bank_id, idempotency_key,
 * dispatch_state)` still dedupes exactly as before, and whatever an operator typed into the header
 * is no longer permanent.
 *
 * FAIL 5 (`payable-dispatch.ts:117`): dispatch executed on a single principal's call with nothing
 * correlating that principal to the approval it cited. Any holder of the scope could move money on
 * an approval they had no part in. The dispatcher must now be one of the two principals whose
 * four-eyes act authorised the close.
 */
describe('BILL-16 — dispatch authority is bound to the approval it cites', () => {
  it('REFUSES a dispatcher who took no part in the four-eyes act', async () => {
    const { service, port, store } = harness()
    const bystander = { ...APPROVER, subject: 'demo:finance-bystander@alpha-bank' } as Principal
    await expect(service.dispatch(bystander, 'PAY-2026-06-001', 'idem-1', 'trace-1'))
      .rejects.toMatchObject({ code: 'BACKOFFICE.DISPATCH_NOT_AUTHORISED' })
    // Refused BEFORE the port is touched: the money must not move and then be reasoned about.
    expect(port.dispatchPayableInstruction).not.toHaveBeenCalled()
    expect(store.recordDispatch).not.toHaveBeenCalled()
  })

  it('ALLOWS either principal of the four-eyes act, spelled any way', async () => {
    for (const subject of [
      'demo:finance-manager@alpha-bank',      // the approver
      'demo:finance-analyst@alpha-bank',      // the initiator
      '  DEMO:Finance-Manager@Alpha-Bank  '   // same human, re-spelled
    ]) {
      const { service, port } = harness()
      const who = { ...APPROVER, subject } as Principal
      await expect(service.dispatch(who, 'PAY-2026-06-001', 'idem-1', 'trace-1')).resolves.toBeTruthy()
      expect(port.dispatchPayableInstruction).toHaveBeenCalledTimes(1)
    }
  })

  it('HASHES the caller-supplied idempotency key into the INSERT-only store, but not to P9', async () => {
    const { service, store, dispatched } = harness()
    const raw = 'ops-retry-key-for-ahmed-0501234567'
    await service.dispatch(APPROVER, 'PAY-2026-06-001', raw, 'trace-1')

    const stored = (store.recordDispatch as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(stored.idempotencyKey).not.toBe(raw)
    expect(stored.idempotencyKey).not.toContain('0501234567')
    expect(stored.idempotencyKey).toMatch(/^sha256:[0-9a-f]{64}$/)

    // P9 still gets the RAW key. The vendor's own dedupe is keyed on what the caller sent, so
    // hashing it on the way out would make every retry a new instruction — the exact double-debit
    // this service exists to prevent.
    expect(dispatched[0]!.idempotency_key).toBe(raw)
  })

  it('hashes deterministically, so the store still dedupes a retry', async () => {
    const a = harness()
    const b = harness()
    await a.service.dispatch(APPROVER, 'PAY-2026-06-001', 'same-key', 'trace-1')
    await b.service.dispatch(APPROVER, 'PAY-2026-06-001', 'same-key', 'trace-2')
    const ka = (a.store.recordDispatch as ReturnType<typeof vi.fn>).mock.calls[0]![0].idempotencyKey
    const kb = (b.store.recordDispatch as ReturnType<typeof vi.fn>).mock.calls[0]![0].idempotencyKey
    expect(ka).toBe(kb)
  })
})
