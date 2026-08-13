import { describe, expect, it, vi } from 'vitest'
import { createFinancialSystemAdapter, financialSystemFromEnv, FinancialSystemError } from '../src/adapters/enterprise/financial-system.js'
import type { FinancialJournalBatch } from '../src/interfaces.js'

const trace = { trace_id: '4d2c2e2a-0000-4000-8000-000000000000' }
const BASE = 'https://erp.bank.example'

function fakeTransport(routes: Record<string, { status?: number; body?: unknown }> = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, init: init ?? {} })
    const key = Object.keys(routes).find((k) => u.includes(k))
    const r = key ? routes[key]! : {}
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

describe('P9 financial-system adapter (invoice EXECUTION transport only)', () => {
  it('registers a counterparty and returns its financial_system_ref', async () => {
    const { calls, fetchImpl } = fakeTransport({ '/counterparties': { body: { financial_system_ref: 'fms-org-001' } } })
    const adapter = createFinancialSystemAdapter({ baseUrl: BASE, getToken: async () => 'tok', fetchImpl })
    const r = await adapter.registerCounterparty({ organisation_id: 'org-001', legal_name: 'Fictional Fintech FZ-LLC' }, trace)
    expect(r.financial_system_ref).toBe('fms-org-001')
    expect(calls[0]!.url).toBe(`${BASE}/counterparties`)
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok')
  })

  it('issues invoice instructions (already reconciled upstream — execution only)', async () => {
    const { calls, fetchImpl } = fakeTransport({ '/invoice-runs': { body: { accepted: true } } })
    const adapter = createFinancialSystemAdapter({ baseUrl: BASE, getToken: async () => 't', fetchImpl })
    const r = await adapter.issueInvoiceInstructions({ invoice_run_id: 'run-1', instructions: [{ line: 1 }] }, trace)
    expect(r.accepted).toBe(true)
    expect(calls[0]!.url).toBe(`${BASE}/invoice-runs`)
  })

  it('posts an already-balanced journal batch and returns the P9 batch reference', async () => {
    const { calls, fetchImpl } = fakeTransport({ '/journal-batches': { body: { accepted: true, journal_batch_ref: 'erp-gl-001' } } })
    const adapter = createFinancialSystemAdapter({ baseUrl: BASE, getToken: async () => 't', fetchImpl })
    const batch = {
      batch_id: 'GL-2026-06', period: '2026-06', posting_date: '2026-07-31', account_profile_ref: 'BANK-COA-1',
      journals: [{ journal_id: 'JRN-1', source_type: 'pint_ae_invoice', source_id: 'INV-1', lines: [
        { account: 'AR', side: 'debit', amount_fils: 105 }, { account: 'REV', side: 'credit', amount_fils: 100 },
        { account: 'VAT', side: 'credit', amount_fils: 5 }
      ] }]
    } satisfies FinancialJournalBatch
    await expect(adapter.postJournalInstructions(batch, trace)).resolves.toEqual({ accepted: true, journal_batch_ref: 'erp-gl-001' })
    expect(calls[0]!.url).toBe(`${BASE}/journal-batches`)
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(batch)
  })

  it('reads settlement status and validates it against the allowed set', async () => {
    const ok = createFinancialSystemAdapter({ baseUrl: BASE, getToken: async () => 't', fetchImpl: fakeTransport({ '/status': { body: { invoice_status: 'settled' } } }).fetchImpl })
    expect((await ok.getSettlementStatus('fms-1', trace)).invoice_status).toBe('settled')

    const bad = createFinancialSystemAdapter({ baseUrl: BASE, getToken: async () => 't', fetchImpl: fakeTransport({ '/status': { body: { invoice_status: 'exploded' } } }).fetchImpl })
    await expect(bad.getSettlementStatus('fms-1', trace)).rejects.toBeInstanceOf(FinancialSystemError)
  })

  it('throws retryable on 5xx', async () => {
    await expect(createFinancialSystemAdapter({ baseUrl: BASE, getToken: async () => 't', fetchImpl: fakeTransport({ '/counterparties': { status: 502 } }).fetchImpl }).registerCounterparty({ organisation_id: 'o', legal_name: 'L' }, trace)).rejects.toMatchObject({ retryable: true, status: 502 })
  })

  it('fail-closed: requires baseUrl + token, and fromEnv throws when unset', () => {
    expect(() => createFinancialSystemAdapter({ baseUrl: BASE })).toThrow(FinancialSystemError)
    expect(() => financialSystemFromEnv({})).toThrow(/misconfigured/)
  })
})
