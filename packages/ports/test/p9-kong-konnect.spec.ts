import { describe, expect, it } from 'vitest'
import {
  KongKonnectFinancialAdapter,
  kongKonnectFromEnv,
  KongKonnectConfigError,
  type KongBillingHttp,
  type KongKonnectConfig
} from '../src/adapters/enterprise/p9-kong-konnect.js'

const trace = { trace_id: '4d2c2e2a-0000-4000-8000-000000000000' }

function fakeHttp(opts: { postStatus?: number; postJson?: unknown; getStatus?: number; getJson?: unknown } = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = []
  const http: KongBillingHttp = {
    async post(path, body) {
      calls.push({ method: 'POST', path, body })
      return { status: opts.postStatus ?? 201, json: opts.postJson ?? { id: 'cust-123' } }
    },
    async get(path) {
      calls.push({ method: 'GET', path })
      return { status: opts.getStatus ?? 200, json: opts.getJson ?? { status: 'paid' } }
    }
  }
  return { http, calls }
}

const adapter = (http: KongBillingHttp, over: Partial<KongKonnectConfig> = {}) =>
  new KongKonnectFinancialAdapter({ baseUrl: 'https://billing.konnect.example', http, ...over })

describe('P9 Kong Konnect — registerCounterparty + settlement (the contract)', () => {
  it('registers a counterparty and tracks settlement (the contract surface)', async () => {
    const { http } = fakeHttp()
    const reg = await adapter(http).registerCounterparty({ organisation_id: 'org-001', legal_name: 'Fictional Fintech FZ-LLC' }, trace)
    expect(reg.financial_system_ref).toBe('cust-123')
    const status = await adapter(http).getSettlementStatus(reg.financial_system_ref, trace)
    expect(['instructed', 'issued', 'settled', 'overdue', 'credit_noted']).toContain(status.invoice_status)
  })

  it('posts the legal name + external id (+ product) to the customers endpoint', async () => {
    const { http, calls } = fakeHttp()
    await adapter(http, { productId: 'prod-9' }).registerCounterparty({ organisation_id: 'org-001', legal_name: 'Acme FZ' }, trace)
    expect(calls[0]!.path).toBe('/v1/billing/customers')
    expect(calls[0]!.body).toMatchObject({ name: 'Acme FZ', external_id: 'org-001', product_id: 'prod-9' })
  })

  it('maps Konnect statuses to the OFBO 5-status lifecycle', async () => {
    const cases: [string, string][] = [
      ['draft', 'instructed'], ['issued', 'issued'], ['paid', 'settled'], ['overdue', 'overdue'], ['voided', 'credit_noted']
    ]
    for (const [konnect, ofbo] of cases) {
      const { http } = fakeHttp({ getJson: { status: konnect } })
      expect((await adapter(http).getSettlementStatus('cust-1', trace)).invoice_status).toBe(ofbo)
    }
  })

  it('refuses to fabricate a settlement state for an unknown Konnect status', async () => {
    const { http } = fakeHttp({ getJson: { status: 'something-new' } })
    await expect(adapter(http).getSettlementStatus('cust-1', trace)).rejects.toThrow(/unmapped/)
  })

  it('issues invoice instructions (accepted on 2xx, throws on non-2xx)', async () => {
    const ok = fakeHttp()
    expect((await adapter(ok.http).issueInvoiceInstructions({ invoice_run_id: 'run-1', instructions: [{ line: 1 }] }, trace)).accepted).toBe(true)
    const bad = fakeHttp({ postStatus: 502 })
    await expect(adapter(bad.http).issueInvoiceInstructions({ invoice_run_id: 'run-1', instructions: [] }, trace)).rejects.toThrow(/HTTP 502/)
  })

  it('fails closed on a non-2xx register, and on a missing customer id', async () => {
    await expect(adapter(fakeHttp({ postStatus: 403 }).http).registerCounterparty({ organisation_id: 'o', legal_name: 'L' }, trace)).rejects.toThrow(/HTTP 403/)
    await expect(adapter(fakeHttp({ postJson: {} }).http).registerCounterparty({ organisation_id: 'o', legal_name: 'L' }, trace)).rejects.toThrow(/missing id/)
  })
})

describe('P9 Kong Konnect — config', () => {
  it('throws a clear config error without base url / auth', () => {
    expect(() => kongKonnectFromEnv({})).toThrow(KongKonnectConfigError)
    expect(() => kongKonnectFromEnv({ P9_KONNECT_BASE_URL: 'https://x' })).toThrow(/AUTH/)
  })
  it('constructs from a complete config', () => {
    expect(kongKonnectFromEnv({ P9_KONNECT_BASE_URL: 'https://x', P9_KONNECT_AUTH: 'Bearer k' })).toBeInstanceOf(KongKonnectFinancialAdapter)
  })
})
