import { describe, expect, it, vi } from 'vitest'
import type { IdentityProviderPort } from '@ofbo/ports'
import type { AuthSinkEvent } from '@ofbo/db'
import {
  listPersonaLogins,
  recentAudit,
  recordSignIn,
  recordSignInFailure,
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
  },
  // ADR 0018 — the portal tests never exercise agent sessions; verify always falls through
  // to the human path (null) and mint is unused.
  async mintAgentSession() {
    throw new Error('not used in portal tests')
  },
  async verifyAgentSession() {
    return null
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

  /**
   * BACKOFFICE-84 — the refusal must name the persona it refused, when it knows one.
   *
   * `recordSignInFailure` was called with `null` for every failure, so the audit row said
   * `acting_persona: 'unknown'` even for `unknown_persona` — a §2 scope-matrix event whose whole
   * subject is WHICH persona was turned away. The BFF records the real persona for the identical
   * refusals (services/bff/src/auth.ts), so two callers were populating the same spec field
   * differently for the same event class. The information was never missing; `SignInError` just
   * did not carry it.
   */
  it('carries the persona on refusals that got far enough to establish one', async () => {
    await expect(verifyAndMint('demo-token:ghost', { idp })).rejects.toMatchObject({
      reason: 'unknown_persona',
      persona: 'ghost-persona'
    })
    await expect(verifyAndMint('demo-token:no-mfa', { idp })).rejects.toMatchObject({
      reason: 'mfa_not_satisfied',
      persona: 'risk-analyst'
    })
  })

  it('carries no persona when the token never resolved to one', async () => {
    // `invalid_token` establishes nothing. Echoing an unverified subject into an INSERT-only trail
    // is exactly what the 'unknown' placeholder exists to prevent — the absence is the fact here.
    await expect(verifyAndMint('garbage', { idp })).rejects.toMatchObject({
      reason: 'invalid_token',
      persona: null
    })
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
        superadmin_marker: false,
        // The status the BROWSER actually received. Without it the emitter infers 200 from the
        // event type, and a sign-in is a 303 to /dashboard — a status no caller ever got, written
        // into a trail with no deletion path.
        response_status: 303
      })
    )
  })

  /**
   * BACKOFFICE-84 — re-pointed from `toBeUndefined()` to the value that replaced it. `recordSignIn`
   * now REPORTS whether it wrote, because "no sink" was the one path that produced a session with
   * no regulated record and nothing threw to stop it. The caller acts on that answer; this asserts
   * the answer is truthful.
   */
  it('reports that it did NOT write when no audit sink is configured', async () => {
    await expect(recordSignIn(principal, 'trace-123', { auditSink: null })).resolves.toBe(false)
  })

  it('reports that it DID write when a sink is present', async () => {
    const written: unknown[] = []
    await expect(
      recordSignIn(principal, 'trace-123', { auditSink: { record: async (e) => { written.push(e) } } })
    ).resolves.toBe(true)
    expect(written).toHaveLength(1)
  })

  /**
   * BACKOFFICE-84 — the failure row must record the persona and the real response status.
   *
   * The emitter derives `response_status` from `event_type` (401 for `signin_failure`), which is
   * correct for the BFF, whose `deny()` returns one. This route answers a form POST with a 303 in
   * every outcome, so the inferred 401 described a response nobody received — and the spec is
   * explicit that the field is "the HTTP status returned to the caller".
   */
  it('records the failure with the refused persona and the status the caller received', async () => {
    const written: AuthSinkEvent[] = []
    await recordSignInFailure('unknown_persona', 'trace-456', 'ghost-persona', {
      auditSink: { record: async (e) => { written.push(e) } }
    })
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({
      event_type: 'signin_failure',
      acting_principal: 'unknown', // no principal was established — that is what failed
      acting_persona: 'ghost-persona',
      reason: 'unknown_persona',
      response_status: 303
    })
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

  it('forwards excludeEventTypes + limit so the dashboard panel can drop auth/scope noise', async () => {
    const recent = vi.fn(async () => [])
    const source: AuditSource = { recent }
    await recentAudit(principal, { auditSource: source }, { excludeEventTypes: ['signin_success', 'scope_denied'], limit: 15 })
    expect(recent).toHaveBeenCalledWith({
      actingPrincipal: 'demo:risk-analyst',
      limit: 15,
      excludeEventTypes: ['signin_success', 'scope_denied']
    })
  })

  it('returns no events when no audit source is configured', async () => {
    await expect(recentAudit(principal, { auditSource: null })).resolves.toEqual([])
  })
})
