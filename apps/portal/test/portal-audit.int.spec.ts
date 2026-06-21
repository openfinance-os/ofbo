import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyMigrations, PgAuditEmitter, PgAuditReader } from '@ofbo/db'
import { recentAudit, recordSignIn, type PortalPrincipal } from '../src/lib/portal.js'

/**
 * M1 exit criterion proof against a real Postgres: the portal sign-in path emits
 * a High-class audit row through the same write path as the BFF, and the "audit
 * visible" surface reads it back under RLS. INSERT-only is untouched — the
 * reader never mutates.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required for integration tests')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
// audit_high_sensitivity is INSERT-only; a unique subject keeps this run's
// events isolated from prior runs that can never be cleaned up.
const principal: PortalPrincipal = {
  subject: `demo:portal-int-${crypto.randomUUID()}`,
  persona: 'risk-analyst',
  scopes: ['risk:read'],
  superadmin: false
}

describe('M1-PORTAL-SHELL — sign-in audit emitted and visible', () => {
  const emitter = new PgAuditEmitter(url!, TENANCY)
  const reader = new PgAuditReader(url!, TENANCY)

  beforeAll(async () => {
    await applyMigrations(url!)
  })
  afterAll(async () => {
    await emitter.close()
    await reader.close()
  })

  it('persists the sign-in event and reads it back for the principal', async () => {
    await recordSignIn(principal, `trace-${crypto.randomUUID()}`, { auditSink: emitter })

    const events = await recentAudit(principal, { auditSource: reader })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      event_type: 'signin_success',
      acting_principal: principal.subject,
      acting_persona: 'risk-analyst',
      response_status: 200,
      superadmin_marker: false
    })
    expect(events[0]?.created_at).toBeTruthy()
  })

  it('scopes the visible trail to the acting principal (RLS + filter)', async () => {
    const events = await recentAudit(principal, { auditSource: reader })
    expect(events.every((e) => e.acting_principal === principal.subject)).toBe(true)
  })

  it('drops low-signal event types from the dashboard panel view (DEMO-01) while keeping operations', async () => {
    // signin (noise) already recorded above; add an operational consent_revoked.
    await emitter.emit({
      event_type: 'consent_revoked',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: 'consents:admin',
      target_consent_id: crypto.randomUUID(),
      request_trace_id: `trace-${crypto.randomUUID()}`,
      request_body: { reason_code: 'TPP_REQUEST' },
      response_status: 200
    })
    const filtered = await recentAudit(principal, { auditSource: reader }, { excludeEventTypes: ['signin_success', 'scope_denied', 'audit_trail_accessed'] })
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.some((e) => e.event_type === 'consent_revoked')).toBe(true)
    expect(filtered.every((e) => e.event_type !== 'signin_success')).toBe(true)
  })
})
