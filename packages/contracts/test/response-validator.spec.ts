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
})
