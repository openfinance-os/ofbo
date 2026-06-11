import { describe, expect, it } from 'vitest'
import type { IdentityProviderPort } from '@ofbo/ports'
import { getAdapter } from '@ofbo/ports'
import { InMemoryAuthAuditSink, mintScopes, SCOPE_MATRIX, ALL_PERSONAS } from '../src/auth.js'
import { createApp } from '../src/app.js'
import { FAPI_HEADERS } from './helpers.js'

const idp = getAdapter('p2-identity-provider', 'demo')
const PATH = '/back-office/reconciliation/runs'

async function appWith(over?: { idp?: IdentityProviderPort }) {
  const audit = new InMemoryAuthAuditSink()
  const app = createApp({ idp: over?.idp ?? idp, audit })
  return { app, audit }
}

describe('BACKOFFICE-47 — mandatory MFA sign-in + admin-scope minting', () => {
  it('rejects requests without a bearer token (401) and audits the failure', async () => {
    const { app, audit } = await appWith()
    const res = await app.request(PATH, { headers: FAPI_HEADERS })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('BACKOFFICE.UNAUTHENTICATED')
    expect(audit.events.some((e) => e.event_type === 'signin_failure')).toBe(true)
  })

  it('rejects an unknown token (401) and audits with the trace id', async () => {
    const { app, audit } = await appWith()
    const res = await app.request(PATH, {
      headers: { ...FAPI_HEADERS, authorization: 'Bearer not-a-token' }
    })
    expect(res.status).toBe(401)
    const failure = audit.events.find((e) => e.event_type === 'signin_failure')
    expect(failure?.trace_id).toBe(FAPI_HEADERS['x-fapi-interaction-id'])
  })

  it('rejects a token without MFA — there is no MFA-skip path (401) — and audits it', async () => {
    const noMfaIdp: IdentityProviderPort = {
      personaLogins: () => idp.personaLogins(),
      verifyToken: async () => ({ subject: 'demo:finance-analyst', persona: 'finance-analyst', mfa: false })
    }
    const { app, audit } = await appWith({ idp: noMfaIdp })
    const res = await app.request(PATH, {
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst' }
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('BACKOFFICE.MFA_REQUIRED')
    expect(audit.events.at(-1)?.reason).toBe('mfa_not_satisfied')
  })

  it('authenticates a demo persona, audits the sign-in, and the stub responds 501', async () => {
    const { app, audit } = await appWith()
    const res = await app.request(PATH, {
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:operations-analyst' }
    })
    expect(res.status).toBe(501) // authenticated; route is a contract-pending stub
    const ok = audit.events.find((e) => e.event_type === 'signin_success')
    expect(ok?.acting_persona).toBe('operations-analyst')
  })

  it('mints exactly the PRD §2 scope matrix — no persona exceeds it', () => {
    expect(ALL_PERSONAS).toHaveLength(8)
    expect(mintScopes('customer-care-agent')).toEqual(['consents:admin', 'disputes:admin', 'audit:read'])
    expect(mintScopes('risk-analyst')).toEqual(['risk:read', 'risk:investigations:write', 'consents:admin:fraud-revoke'])
    // scope hygiene is load-bearing: Finance never holds consent-admin; Care never holds finance/risk
    expect(mintScopes('finance-analyst')).not.toContain('consents:admin')
    expect(mintScopes('customer-care-agent').some((s) => s.startsWith('finance:') || s.startsWith('risk:'))).toBe(false)
    // Risk's only consent power is the narrow fraud-revoke
    expect(mintScopes('risk-analyst')).not.toContain('consents:admin')
  })

  it('platform-super-admin holds the marker scope plus the union of all scopes (BACKOFFICE-80 prep)', () => {
    const s = mintScopes('platform-super-admin')
    expect(s).toContain('platform:superadmin')
    for (const persona of ALL_PERSONAS.filter((p) => p !== 'platform-super-admin')) {
      for (const scope of SCOPE_MATRIX[persona]) expect(s).toContain(scope)
    }
  })

  it('rejects an unknown persona in a structurally valid token', async () => {
    const { app } = await appWith()
    const res = await app.request(PATH, {
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:not-a-persona' }
    })
    expect(res.status).toBe(401)
  })
})
