import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { InMemoryQueryPurposeRegistrar } from '../src/governance/query-purposes.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-33 PR 5 — four-eyes registration of a NEW cross-fintech query purpose
 * (BD-13 / ADR 0015: Option 1 + four-eyes). New scope compliance:query-purposes:write
 * on compliance-officer. Returns 202 + approval_request; the purpose becomes active
 * (approved_by set) only when a DIFFERENT principal approves — never inline. The demo
 * subject is per-persona, so the approver is the super-admin (distinct subject, holds the
 * scope via the union).
 */

const compliance = (extra: Record<string, string> = {}) => ({
  ...FAPI_HEADERS,
  authorization: 'Bearer demo-token:compliance-officer',
  'content-type': 'application/json',
  ...extra
})
const superAdmin = (extra: Record<string, string> = {}) => ({
  ...FAPI_HEADERS,
  authorization: 'Bearer demo-token:platform-super-admin',
  'x-superadmin-justification': 'four-eyes approval of a new cross-fintech query purpose registration (test)',
  'content-type': 'application/json',
  ...extra
})

function appWith() {
  const audit = new InMemoryHighClassAuditSink()
  const registrar = new InMemoryQueryPurposeRegistrar()
  return { app: createApp({ highClassAudit: audit, queryPurposeRegistrar: registrar }), audit, registrar }
}

const body = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ purpose_code: 'fraud_pattern_review', description: 'Cross-fintech fraud-pattern aggregate reads for the Risk desk', ...over })

describe('POST /back-office/governance/query-purposes', () => {
  it('is four-eyes-gated: 202 + pending approval, nothing registered inline', async () => {
    const { app, registrar } = appWith()
    const res = await app.request('/back-office/governance/query-purposes', { method: 'POST', headers: compliance({ 'idempotency-key': 'qp1' }), body: body() })
    expect(res.status).toBe(202)
    const ar = (await res.json()) as { data: { state: string; operation_type: string } }
    expect(ar.data.state).toBe('pending')
    expect(ar.data.operation_type).toBe('query_purpose.register')
    expect(registrar.registered).toHaveLength(0) // never registered inline
  })

  it('registers only on a different principal’s approval: approved_by = approver, registered_by = initiator', async () => {
    const { app, audit, registrar } = appWith()
    const init = await app.request('/back-office/governance/query-purposes', { method: 'POST', headers: compliance({ 'idempotency-key': 'qp2' }), body: body() })
    const approvalId = ((await init.json()) as { data: { approval_request_id: string } }).data.approval_request_id

    // self-approval rejected (four-eyes), still nothing registered
    const self = await app.request(`/approvals/${approvalId}:approve`, { method: 'POST', headers: compliance({ 'idempotency-key': 'qp-self' }) })
    expect(self.status).toBe(409)
    expect(registrar.registered).toHaveLength(0)

    const ok = await app.request(`/approvals/${approvalId}:approve`, { method: 'POST', headers: superAdmin({ 'idempotency-key': 'qp-ok' }) })
    expect(ok.status).toBe(200)
    const exec = ((await ok.json()) as { data: { execution_result?: { status?: string; approved_by?: string } } }).data.execution_result
    expect(exec?.status).toBe('Registered')
    expect(exec?.approved_by).toBe('demo:platform-super-admin')

    expect(registrar.registered).toHaveLength(1)
    const reg = registrar.registered[0]!
    expect(reg.purpose_code).toBe('fraud_pattern_review')
    expect(reg.registered_by).toBe('demo:compliance-officer')
    expect(reg.approved_by).toBe('demo:platform-super-admin')

    const ev = audit.events.find((e) => e.event_type === 'query_purpose_registered')
    expect(ev?.scope_used).toBe('compliance:query-purposes:write')
    expect((ev?.request_body as { purpose_code: string }).purpose_code).toBe('fraud_pattern_review')
    expect((ev?.request_body as { four_eyes_approved: boolean }).four_eyes_approved).toBe(true)
  })

  it('the operator-facing approval summary echoes only the format-validated purpose_code, never the free-text description', async () => {
    const { app } = appWith()
    const init = await app.request('/back-office/governance/query-purposes', { method: 'POST', headers: compliance({ 'idempotency-key': 'qp-sum' }), body: body() })
    const ar = (await init.json()) as { data: { operation_summary?: { descriptor?: string } } }
    expect(ar.data.operation_summary?.descriptor).toContain('fraud_pattern_review')
    expect(JSON.stringify(ar.data.operation_summary)).not.toContain('Risk desk') // description never surfaced
  })

  it('validates the body: bad purpose_code, short description, unknown field, missing Idempotency-Key → 400', async () => {
    const { app } = appWith()
    // uppercase purpose_code violates ^[a-z][a-z0-9_]{2,63}$
    expect((await app.request('/back-office/governance/query-purposes', { method: 'POST', headers: compliance({ 'idempotency-key': 'qp-a' }), body: body({ purpose_code: 'BadCode' }) })).status).toBe(400)
    // description under 8 chars
    expect((await app.request('/back-office/governance/query-purposes', { method: 'POST', headers: compliance({ 'idempotency-key': 'qp-b' }), body: body({ description: 'short' }) })).status).toBe(400)
    // additionalProperties: false
    expect((await app.request('/back-office/governance/query-purposes', { method: 'POST', headers: compliance({ 'idempotency-key': 'qp-c' }), body: body({ approved_by: 'demo:compliance-officer' }) })).status).toBe(400)
    // Idempotency-Key required on a mutating endpoint
    expect((await app.request('/back-office/governance/query-purposes', { method: 'POST', headers: compliance(), body: body() })).status).toBe(400)
  })

  it('rejects a persona without compliance:query-purposes:write (403) — finance-analyst', async () => {
    const { app, registrar } = appWith()
    const res = await app.request('/back-office/governance/query-purposes', {
      method: 'POST',
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst', 'content-type': 'application/json', 'idempotency-key': 'qp-d' },
      body: body()
    })
    expect(res.status).toBe(403)
    expect(registrar.registered).toHaveLength(0)
  })
})
