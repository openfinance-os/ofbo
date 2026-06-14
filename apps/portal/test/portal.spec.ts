import { describe, expect, it, vi } from 'vitest'
import type { IdentityProviderPort } from '@ofbo/ports'
import {
  listPersonaLogins,
  recentAudit,
  recordSignIn,
  SignInError,
  verifyAndMint,
  type AuditSink,
  type AuditSource,
  type PortalPrincipal
} from '../src/lib/portal.js'

/**
 * M1-PORTAL-SHELL — the portal session library composes the SAME primitives the
 * BFF uses (P2 IdP port, §2 scope matrix via mintScopes, High-class audit). It
 * invents no auth path; these tests pin that composition.
 */

const idp: IdentityProviderPort = {
  async personaLogins() {
    return [
      { persona: 'risk-analyst', display_name: 'OF Risk Analyst', demo_token: 'demo-token:risk-analyst' },
      { persona: 'platform-super-admin', display_name: 'Platform Super Administrator', demo_token: 'demo-token:platform-super-admin' }
    ]
  },
  async verifyToken(token) {
    switch (token) {
      case 'demo-token:risk-analyst':
        return { subject: 'demo:risk-analyst', persona: 'risk-analyst', mfa: true }
      case 'demo-token:platform-super-admin':
        return { subject: 'demo:platform-super-admin', persona: 'platform-super-admin', mfa: true }
      case 'demo-token:no-mfa':
        return { subject: 'demo:risk-analyst', persona: 'risk-analyst', mfa: false }
      case 'demo-token:ghost':
        return { subject: 'demo:ghost', persona: 'ghost-persona', mfa: true }
      default:
        throw new Error('unknown demo token')
    }
  }
}

describe('verifyAndMint', () => {
  it('mints the §2 matrix scopes for a valid MFA persona', async () => {
    const p = await verifyAndMint('demo-token:risk-analyst', { idp })
    expect(p.subject).toBe('demo:risk-analyst')
    expect(p.persona).toBe('risk-analyst')
    expect(p.superadmin).toBe(false)
    expect(p.scopes).toEqual(expect.arrayContaining(['risk:read', 'risk:investigations:write', 'consents:admin:fraud-revoke']))
  })

  it('flags the super-admin marker and unions all scopes', async () => {
    const p = await verifyAndMint('demo-token:platform-super-admin', { idp })
    expect(p.superadmin).toBe(true)
    expect(p.scopes).toContain('platform:superadmin')
    // union of all personas — e.g. a Finance scope is present on the super-admin
    expect(p.scopes).toContain('billing:write')
  })

  it('rejects when MFA is not satisfied — no skip path', async () => {
    await expect(verifyAndMint('demo-token:no-mfa', { idp })).rejects.toMatchObject({
      name: 'SignInError',
      reason: 'mfa_not_satisfied'
    })
  })

  it('rejects a persona outside the matrix (zero scopes minted)', async () => {
    await expect(verifyAndMint('demo-token:ghost', { idp })).rejects.toBeInstanceOf(SignInError)
    await expect(verifyAndMint('demo-token:ghost', { idp })).rejects.toMatchObject({ reason: 'unknown_persona' })
  })

  it('rejects a token the IdP will not verify', async () => {
    await expect(verifyAndMint('garbage', { idp })).rejects.toMatchObject({ reason: 'invalid_token' })
  })
})

describe('listPersonaLogins', () => {
  it('returns the IdP persona login options', async () => {
    const logins = await listPersonaLogins({ idp })
    expect(logins.map((l) => l.persona)).toContain('risk-analyst')
    expect(logins[0]?.demo_token).toMatch(/^demo-token:/)
  })
})

describe('recordSignIn', () => {
  const principal: PortalPrincipal = {
    subject: 'demo:risk-analyst',
    persona: 'risk-analyst',
    scopes: ['risk:read'],
    superadmin: false
  }

  it('emits a signin_success High-class event with the trace id', async () => {
    const record = vi.fn(async () => {})
    const sink: AuditSink = { record }
    await recordSignIn(principal, 'trace-123', { auditSink: sink })
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'signin_success',
        acting_principal: 'demo:risk-analyst',
        acting_persona: 'risk-analyst',
        trace_id: 'trace-123',
        superadmin_marker: false
      })
    )
  })

  it('is a no-op when no audit sink is configured (degraded local dev)', async () => {
    await expect(recordSignIn(principal, 'trace-123', { auditSink: null })).resolves.toBeUndefined()
  })
})

describe('recentAudit', () => {
  const principal: PortalPrincipal = {
    subject: 'demo:risk-analyst',
    persona: 'risk-analyst',
    scopes: ['risk:read'],
    superadmin: false
  }

  it('reads recent events for the principal from the audit source', async () => {
    const recent = vi.fn(async () => [
      {
        id: 'e1',
        event_type: 'signin_success',
        acting_principal: 'demo:risk-analyst',
        acting_persona: 'risk-analyst',
        scope_used: 'none',
        request_trace_id: 'trace-123',
        response_status: 200,
        superadmin_marker: false,
        created_at: '2026-06-14T00:00:00.000Z'
      }
    ])
    const source: AuditSource = { recent }
    const events = await recentAudit(principal, { auditSource: source })
    expect(recent).toHaveBeenCalledWith({ actingPrincipal: 'demo:risk-analyst', limit: 10 })
    expect(events).toHaveLength(1)
    expect(events[0]?.event_type).toBe('signin_success')
  })

  it('returns no events when no audit source is configured', async () => {
    await expect(recentAudit(principal, { auditSource: null })).resolves.toEqual([])
  })
})
