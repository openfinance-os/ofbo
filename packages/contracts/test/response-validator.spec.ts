import { describe, expect, it } from 'vitest'
import { buildResponseValidator } from '../src/response-validator.js'
import { ROUTES } from '../src/index.js'

/** A known GET with a JSON object response envelope (data/meta) to probe against. */
const PROBE = ROUTES.find((r) => r.method === 'get' && r.path === '/approvals/pending')!

describe('buildResponseValidator — the contract-conformance harness itself', () => {
  const v = buildResponseValidator()

  it('rejects a body that does not match the response schema (proves it is not a no-op)', () => {
    const check = v.validate('get', PROBE.path, 200, 'not-an-object')
    expect(check.skipped).toBe(false)
    expect(check.ok).toBe(false)
    expect(check.errors.length).toBeGreaterThan(0)
  })

  it('accepts a structurally valid envelope for the same route+status', () => {
    const check = v.validate('get', PROBE.path, 200, { data: [], meta: { request_id: crypto.randomUUID(), timestamp: new Date().toISOString() } })
    expect(check.skipped).toBe(false)
    expect(check.ok, check.errors.join('; ')).toBe(true)
  })

  it('skips (method, path, status) combinations the contract has no JSON schema for', () => {
    const check = v.validate('get', '/this/path/is/not/in/the/spec', 200, { anything: true })
    expect(check.skipped).toBe(true)
    expect(check.ok).toBe(true)
  })

  // A `nullable: true` OBJECT reference (e.g. InvoiceRun.net_settlement_offset via allOf: [Money])
  // must accept null — the OAS-3.0 nullable-object case. Regression: previously the converter only
  // folded `nullable` for scalar `type`, so a legitimately-null field false-drifted as "must be object".
  const meta = () => ({ request_id: crypto.randomUUID(), timestamp: new Date().toISOString() })
  const invoiceRun = (offset: unknown) => ({
    invoice_run_id: crypto.randomUUID(),
    billing_period: '2026-05',
    record_set_id: crypto.randomUUID(),
    status: 'settled',
    approval_id: null,
    invoices: [],
    withheld_line_count: 0,
    net_settlement_offset: offset
  })

  it('accepts a null value for a nullable object-ref field (net_settlement_offset)', () => {
    const check = v.validate('get', '/back-office/invoice-runs', 200, { data: [invoiceRun(null)], meta: meta() })
    expect(check.skipped).toBe(false)
    expect(check.ok, check.errors.join('; ')).toBe(true)
  })

  it('still accepts a well-formed object for the same nullable field, and rejects a wrong-typed one', () => {
    const good = v.validate('get', '/back-office/invoice-runs', 200, { data: [invoiceRun({ amount: 1000, currency: 'AED' })], meta: meta() })
    expect(good.ok, good.errors.join('; ')).toBe(true)
    const bad = v.validate('get', '/back-office/invoice-runs', 200, { data: [invoiceRun('not-money')], meta: meta() })
    expect(bad.ok).toBe(false)
  })
})
