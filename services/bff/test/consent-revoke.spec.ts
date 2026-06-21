import { describe, expect, it } from 'vitest'
import type { TraceContext } from '@ofbo/ports'
import { generateDemoDataset } from '@ofbo/synthetic-data'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-17 — single-consent revocation. Contract + acceptance: reason-code
 * validation (FRAUD_SUSPECTED reserved), Idempotency-Key replay, P6-propagation
 * time surfaced (<5s p99) incl. the injected-fault SLA-breach path, exactly one
 * High-class consent_revoked audit, scope enforced at the BFF layer.
 */

const CONSENT = '22222222-2222-4222-8222-222222222222'

class FakeEgress {
  calls = 0
  constructor(private readonly ms = 420) {}
  async revokeConsent(_consentId: string, _reason: string, _trace: TraceContext) {
    this.calls++
    return { acknowledged_in_ms: this.ms }
  }
  async createDisputeCase() {
    return { nebras_case_id: 'nebras-unused' }
  }
  async dispatchRefund() {
    return { ipp_status: 'ACSP' }
  }
}

const care = (extra: Record<string, string> = {}) => ({
  ...FAPI_HEADERS,
  authorization: 'Bearer demo-token:customer-care-agent',
  'content-type': 'application/json',
  'idempotency-key': 'idem-revoke-1',
  ...extra
})

function appWith(ms?: number) {
  const audit = new InMemoryHighClassAuditSink()
  const egress = new FakeEgress(ms)
  return { app: createApp({ nebrasEgress: egress, highClassAudit: audit }), audit, egress }
}

const post = (app: ReturnType<typeof createApp>, headers: Record<string, string>, reason_code?: string) =>
  app.request(`/consents/${CONSENT}:revoke-admin`, {
    method: 'POST',
    headers,
    body: JSON.stringify(reason_code ? { reason_code } : {})
  })

describe('POST /consents/{consent_id}:revoke-admin', () => {
  it('revokes with a valid reason code: 200 RevocationResult + one consent_revoked audit', async () => {
    const { app, audit, egress } = appWith()
    const res = await post(app, care(), 'CLIENT_INSTRUCTION')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { consent_id: string; status: string; nebras_propagation_ms: number; psu_notified: boolean } }
    expect(body.data).toMatchObject({ consent_id: CONSENT, status: 'Revoked', psu_notified: true })
    expect(body.data.nebras_propagation_ms).toBe(420)
    expect(egress.calls).toBe(1)
    expect(audit.events).toHaveLength(1)
    expect(audit.events[0]).toMatchObject({ event_type: 'consent_revoked', target_consent_id: CONSENT, scope_used: 'consents:admin' })
    expect((audit.events[0]!.request_body as { reason_code: string }).reason_code).toBe('CLIENT_INSTRUCTION')
  })

  it('stamps target_psu_identifier resolved from the consent so the revoke shows in the PSU timeline (DEMO-01)', async () => {
    // A real consent from the deterministic dataset → createApp's directory resolves its PSU.
    const psu = generateDemoDataset().psus[0]!
    const consentId = psu.consents[0]!.consent_id
    const { app, audit } = appWith()
    const res = await app.request(`/consents/${consentId}:revoke-admin`, {
      method: 'POST',
      headers: care({ 'idempotency-key': 'idem-psu-stamp' }),
      body: JSON.stringify({ reason_code: 'TPP_REQUEST' })
    })
    expect(res.status).toBe(200)
    expect(audit.events).toHaveLength(1)
    expect(audit.events[0]).toMatchObject({
      event_type: 'consent_revoked',
      target_consent_id: consentId,
      target_psu_identifier: psu.bank_customer_id
    })
  })

  it('rejects FRAUD_SUSPECTED (reserved for :revoke-fraud) with 400, no egress call', async () => {
    const { app, egress, audit } = appWith()
    const res = await post(app, care(), 'FRAUD_SUSPECTED')
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BACKOFFICE.REASON_CODE_RESERVED')
    expect(egress.calls).toBe(0)
    expect(audit.events).toHaveLength(0)
  })

  it('rejects an unknown reason code with 400', async () => {
    const { app } = appWith()
    const res = await post(app, care(), 'BECAUSE')
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BACKOFFICE.INVALID_REASON_CODE')
  })

  it('requires an Idempotency-Key (400) and replays the original result within the window', async () => {
    const { app, egress } = appWith()
    const noKey = await post(app, care({ 'idempotency-key': '' }), 'TPP_REQUEST')
    expect(noKey.status).toBe(400)
    expect(((await noKey.json()) as { error: { code: string } }).error.code).toBe('BACKOFFICE.MISSING_IDEMPOTENCY_KEY')

    const first = await post(app, care(), 'TPP_REQUEST')
    const second = await post(app, care(), 'TPP_REQUEST') // same key → replay
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(egress.calls).toBe(1) // no duplicate Nebras revocation
  })

  it('does not replay across different consents reusing the same Idempotency-Key', async () => {
    const { app, egress } = appWith()
    await post(app, care(), 'TPP_REQUEST') // revoke CONSENT with key idem-revoke-1
    const other = await app.request(`/consents/33333333-3333-4333-8333-333333333333:revoke-admin`, {
      method: 'POST',
      headers: care(), // SAME idempotency-key, different consent
      body: JSON.stringify({ reason_code: 'TPP_REQUEST' })
    })
    expect(other.status).toBe(200)
    expect(((await other.json()) as { data: { consent_id: string } }).data.consent_id).toBe('33333333-3333-4333-8333-333333333333')
    expect(egress.calls).toBe(2) // both consents actually revoked
  })

  it('surfaces an SLA breach when the Nebras propagation exceeds 5s (injected fault)', async () => {
    const { app, audit } = appWith(9000)
    const res = await post(app, care(), 'REGULATORY')
    expect(res.status).toBe(200) // revocation still succeeds; the SLA is a monitored metric
    const body = (await res.json()) as { data: { nebras_propagation_ms: number } }
    expect(body.data.nebras_propagation_ms).toBe(9000)
    expect((audit.events[0]!.request_body as { sla_met: boolean }).sla_met).toBe(false)
  })

  it('rejects a persona without consents:admin at the BFF layer (403)', async () => {
    const { app, egress } = appWith()
    const res = await post(app, { ...care(), authorization: 'Bearer demo-token:risk-analyst' }, 'TPP_REQUEST')
    expect(res.status).toBe(403)
    expect(egress.calls).toBe(0)
  })
})
