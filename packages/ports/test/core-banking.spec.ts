import { describe, expect, it, vi } from 'vitest'
import { createCoreBankingAdapter, coreBankingFromEnv, CoreBankingError } from '../src/adapters/enterprise/core-banking.js'

const trace = { trace_id: '4d2c2e2a-0000-4000-8000-000000000000' }
const BASE = 'https://core.bank.example'

function fakeTransport(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

describe('P4 core-banking adapter (read-only, integer minor units)', () => {
  it('GETs the balance with bearer + trace header and returns binding Money', async () => {
    const { calls, fetchImpl } = fakeTransport({ amount: 1_500_000, currency: 'AED', as_of: '2026-06-26T00:00:00.000Z' })
    const adapter = createCoreBankingAdapter({ baseUrl: BASE, getToken: async () => 'tok', fetchImpl })
    const b = await adapter.getBalance('acc-001', trace)
    expect(b.balance).toEqual({ amount: 1_500_000, currency: 'AED' })
    expect(calls[0]!.url).toBe(`${BASE}/accounts/acc-001/balance`)
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer tok')
    expect(headers['x-fapi-interaction-id']).toBe(trace.trace_id)
  })

  it('passes the window on getTransactions and maps each row to Money', async () => {
    const { calls, fetchImpl } = fakeTransport([{ ref: 'tx-1', amount: -25_000, currency: 'AED', booked_at: '2026-06-01T08:00:00Z' }])
    const adapter = createCoreBankingAdapter({ baseUrl: BASE, getToken: async () => 't', fetchImpl })
    const txns = await adapter.getTransactions('acc-001', { from: '2026-06-01', to: '2026-06-30' }, trace)
    expect(txns[0]).toEqual({ ref: 'tx-1', amount: { amount: -25_000, currency: 'AED' }, booked_at: '2026-06-01T08:00:00Z' })
    expect(calls[0]!.url).toBe(`${BASE}/accounts/acc-001/transactions?from=2026-06-01&to=2026-06-30`)
  })

  it('rejects a non-integer amount (Money must be integer minor units)', async () => {
    const { fetchImpl } = fakeTransport({ amount: 1500.5, currency: 'AED' })
    const adapter = createCoreBankingAdapter({ baseUrl: BASE, getToken: async () => 't', fetchImpl })
    await expect(adapter.getBalance('acc-001', trace)).rejects.toBeInstanceOf(CoreBankingError)
  })

  it('throws retryable on 5xx', async () => {
    await expect(createCoreBankingAdapter({ baseUrl: BASE, getToken: async () => 't', fetchImpl: fakeTransport({}, 503).fetchImpl }).getBalance('a', trace)).rejects.toMatchObject({ retryable: true, status: 503 })
  })

  it('fail-closed: requires baseUrl + token at construction, and fromEnv throws when unset', () => {
    expect(() => createCoreBankingAdapter({ baseUrl: BASE })).toThrow(CoreBankingError) // no token
    expect(() => createCoreBankingAdapter({})).toThrow(CoreBankingError) // no baseUrl
    expect(() => coreBankingFromEnv({})).toThrow(/misconfigured/)
  })
})
