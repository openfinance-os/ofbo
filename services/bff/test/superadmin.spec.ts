import { describe, expect, it } from 'vitest'
import type { IdentityProviderPort } from '@ofbo/ports'
import { getAdapter } from '@ofbo/ports'
import { InMemoryAuthAuditSink } from '../src/auth.js'
import { InMemoryRiskSignalSink } from '../src/superadmin.js'
import { createApp } from '../src/app.js'
import { FAPI_HEADERS } from './helpers.js'

const idp = getAdapter('p2-identity-provider', 'demo')

function build(over?: { idp?: IdentityProviderPort }) {
  const audit = new InMemoryAuthAuditSink()
  const riskSignals = new InMemoryRiskSignalSink()
  const tickets: { type: string; severity: string; team: string; summary: string }[] = []
  const itsm = {
    createTicket: async (input: { type: string; severity: 'low' | 'medium' | 'high' | 'critical'; team: string; summary: string }) => {
      tickets.push(input)
      return { ticket_id: `itsm-${tickets.length}` }
    }
  }
  const app = createApp({ idp: over?.idp ?? idp, audit, superadmin: { itsm, riskSignals } })
  return { app, audit, riskSignals, tickets }
}

const SA = {
  ...FAPI_HEADERS,
  authorization: 'Bearer demo-token:platform-super-admin'
}
const JUSTIFIED = { ...SA, 'x-superadmin-justification': 'incident recovery: replaying failed reconciliation window' }

describe('BACKOFFICE-80 — super-admin guardrails (code-enforced)', () => {
  it('a super-admin session auto-raises ONE informational ITSM ticket + ONE risk signal — not one per request', async () => {
    const { app, tickets, riskSignals } = build()
    await app.request('/back-office/reconciliation/runs', { headers: SA })
    await app.request('/back-office/analytics/risk-view', { headers: SA })
    expect(tickets).toHaveLength(1)
    expect(tickets[0]!.severity).toBe('low')
    expect(riskSignals.signals).toHaveLength(1)
    expect(riskSignals.signals[0]!.signal_type).toBe('agent_anomaly')
    expect(riskSignals.signals[0]!.severity).toBe('info')
  })

  it('ordinary personas raise neither ticket nor signal', async () => {
    const { app, tickets, riskSignals } = build()
    await app.request('/back-office/reconciliation/runs', {
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst' }
    })
    expect(tickets).toHaveLength(0)
    expect(riskSignals.signals).toHaveLength(0)
  })

  it('rejects a service-account token carrying the super-admin persona (no automations, ever)', async () => {
    const svcIdp: IdentityProviderPort = {
      personaLogins: () => idp.personaLogins(),
      verifyToken: async () => ({ subject: 'svc:nightly-batch', persona: 'platform-super-admin', mfa: true })
    }
    const { app, audit } = build({ idp: svcIdp })
    const res = await app.request('/back-office/reconciliation/runs', { headers: SA })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('BACKOFFICE.SERVICE_ACCOUNT_SUPERADMIN_FORBIDDEN')
    expect(audit.events.at(-1)?.reason).toBe('service_account_superadmin')
  })

  it('mutating super-admin actions require a ≥20-char justification', async () => {
    const { app } = build()
    const post = (headers: Record<string, string>) =>
      app.request('/approvals', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ operation_type: 'x', operation_payload: {} })
      })
    const missing = await post(SA)
    expect(missing.status).toBe(400)
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('BACKOFFICE.JUSTIFICATION_REQUIRED')
    const short = await post({ ...SA, 'x-superadmin-justification': 'because' })
    expect(short.status).toBe(400)
    const ok = await post(JUSTIFIED)
    // proceeds past the guardrail into the route — the failure is now the route's
    // own (unregistered operation), not JUSTIFICATION_REQUIRED
    expect(((await ok.json()) as { error: { code: string } }).error.code).toBe('BACKOFFICE.UNKNOWN_OPERATION')
  })

  it('records the justification on a High-class audit event', async () => {
    const { app, audit } = build()
    await app.request('/approvals', {
      method: 'POST',
      headers: { ...JUSTIFIED, 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ operation_type: 'x', operation_payload: {} })
    })
    const ev = audit.events.find((e) => e.event_type === 'superadmin_mutation')
    expect(ev?.justification).toContain('incident recovery')
    expect(ev?.superadmin_marker).toBe(true)
  })

  it('reads need no justification; ordinary personas mutate without one', async () => {
    const { app } = build()
    const read = await app.request('/back-office/analytics/onboarding-handover-health', { headers: SA })
    expect(read.status).toBe(501)
    const finance = await app.request('/approvals', {
      method: 'POST',
      headers: {
        ...FAPI_HEADERS,
        authorization: 'Bearer demo-token:finance-analyst',
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID()
      },
      body: JSON.stringify({ operation_type: 'x', operation_payload: {} })
    })
    expect(finance.status).toBe(400) // UNKNOWN_OPERATION — not JUSTIFICATION_REQUIRED
    expect(((await finance.json()) as { error: { code: string } }).error.code).toBe('BACKOFFICE.UNKNOWN_OPERATION')
  })
})
