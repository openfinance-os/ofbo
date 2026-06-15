import { describe, expect, it } from 'vitest'
import { getAdapter } from '@ofbo/ports'
import { ROUTES } from '@ofbo/contracts'
import { assertScope, hasScope, isDynamicScope, ScopeDeniedError } from '../src/rbac.js'
import { InMemoryAuthAuditSink, mintScopes } from '../src/auth.js'
import { createApp } from '../src/app.js'
import { FAPI_HEADERS } from './helpers.js'

const idp = getAdapter('p2-identity-provider', 'demo')

function appWithAudit() {
  const audit = new InMemoryAuthAuditSink()
  return { app: createApp({ idp, audit }), audit }
}
const asPersona = (p: string) => ({ ...FAPI_HEADERS, authorization: `Bearer demo-token:${p}` })

describe('BACKOFFICE-43 — RBAC enforcement, both layers, audited denials', () => {
  it('denies out-of-matrix access with 403 + required_scope and audits persona/attempted scope/reason', async () => {
    const { app, audit } = appWithAudit()
    // Customer Care has no reconciliation scope
    const res = await app.request('/back-office/reconciliation/runs', { headers: asPersona('customer-care-agent') })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: Record<string, string> }
    expect(body.error.code).toBe('BACKOFFICE.SCOPE_DENIED')
    expect(body.error.required_scope).toBe('reconciliation:read')
    const denial = audit.events.find((e) => e.event_type === 'scope_denied')
    expect(denial?.acting_persona).toBe('customer-care-agent')
    expect(denial?.attempted_scope).toBe('reconciliation:read')
    expect(denial?.reason).toBe('scope_not_held')
  })

  it('allows in-matrix access through to the stub (501)', async () => {
    const { app } = appWithAudit()
    const finance = await app.request('/back-office/reconciliation/thresholds', { headers: asPersona('finance-analyst') })
    expect(finance.status).toBe(501)
    // A still-stubbed consents:admin route — proves Customer Care passes the
    // scope middleware (the implemented search route is covered in consents.spec).
    const care = await app.request('/consents/4d2c2e2a-0000-4000-8000-000000000000:admin', {
      headers: asPersona('customer-care-agent')
    })
    expect(care.status).toBe(501)
  })

  it('keeps the matrix symmetric: Finance cannot touch consent admin', async () => {
    const { app } = appWithAudit()
    const res = await app.request('/consents:search-psu?identifier_type=bank_customer_id&identifier=x', {
      headers: asPersona('finance-analyst')
    })
    expect(res.status).toBe(403)
  })

  it('super-admin passes every scope check and the audit record carries the marker (BACKOFFICE-43/-80)', async () => {
    const { app, audit } = appWithAudit()
    const res = await app.request('/back-office/reconciliation/thresholds', { headers: asPersona('platform-super-admin') })
    expect(res.status).toBe(501)
    const ok = audit.events.find((e) => e.event_type === 'signin_success')
    expect(ok?.superadmin_marker).toBe(true)
  })

  it('dynamic-scope routes (parenthesised in the spec) pass the middleware layer for any authenticated persona', async () => {
    const dynamic = ROUTES.find((r) => r.scope?.startsWith('('))
    expect(dynamic).toBeDefined()
    expect(isDynamicScope(dynamic!.scope)).toBe(true)
    const { app } = appWithAudit()
    const res = await app.request('/approvals/pending', { headers: asPersona('commercial-desk-head') })
    // middleware lets dynamic scopes through; the approvals service (BACKOFFICE-44)
    // enforces request-dependent access — an empty pending list, not a 403/501
    expect(res.status).toBe(200)
  })

  it('service layer enforces independently of the middleware (defence in depth)', () => {
    const care = { subject: 's', persona: 'customer-care-agent' as const, scopes: mintScopes('customer-care-agent') }
    expect(() => assertScope(care, 'reconciliation:read')).toThrow(ScopeDeniedError)
    expect(() => assertScope(care, 'consents:admin')).not.toThrow()
    const admin = { subject: 's', persona: 'platform-super-admin' as const, scopes: mintScopes('platform-super-admin') }
    expect(() => assertScope(admin, 'reconciliation:read')).not.toThrow()
    expect(hasScope(care.scopes, 'audit:read')).toBe(true)
    expect(hasScope(care.scopes, 'billing:write')).toBe(false)
  })
})
