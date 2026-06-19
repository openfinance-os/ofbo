import { describe, expect, it } from 'vitest'
import { generateDemoDataset } from '@ofbo/synthetic-data'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-61 — GET /consents/{consent_id}:admin. Admin detail of one consent
 * including multi-authorisation (M-of-N) authoriser visibility on payment consents.
 * consents:admin (BFF middleware + service re-check); one High-class audit per view.
 */

const ds = generateDemoDataset()
const allConsents = ds.psus.flatMap((p) => p.consents)
const paymentConsent = allConsents.find((c) => c.purpose === 'SIP_PAYMENT')!
const plainConsent = allConsents.find((c) => c.purpose !== 'SIP_PAYMENT')!

const care = (extra: Record<string, string> = {}) => ({ ...FAPI_HEADERS, authorization: 'Bearer demo-token:customer-care-agent', ...extra })

function appWith() {
  const audit = new InMemoryHighClassAuditSink()
  return { app: createApp({ highClassAudit: audit }), audit }
}

type Wire = {
  consent_id: string
  multi_auth: { threshold: number; received: number; pending: boolean; authorisers: { authoriser_ref: string; status: string; authorised_at: string | null }[] } | null
}

describe('GET /consents/{consent_id}:admin (BACKOFFICE-61)', () => {
  it('returns the consent admin view with the multi-auth M-of-N block for a payment consent + one audit', async () => {
    const { app, audit } = appWith()
    const res = await app.request(`/consents/${paymentConsent.consent_id}:admin`, { headers: care() })
    expect(res.status).toBe(200)
    const data = ((await res.json()) as { data: Wire }).data
    expect(data.consent_id).toBe(paymentConsent.consent_id)
    expect(data.multi_auth).not.toBeNull()
    const ma = data.multi_auth!
    expect(ma.threshold).toBeGreaterThanOrEqual(2)
    expect(ma.authorisers).toHaveLength(ma.threshold)
    expect(ma.received).toBe(ma.authorisers.filter((a) => a.status === 'authorised').length)
    expect(ma.pending).toBe(ma.received < ma.threshold)
    expect(audit.events).toHaveLength(1)
    expect(audit.events[0]).toMatchObject({ event_type: 'consent_admin_view', target_consent_id: paymentConsent.consent_id })
  })

  it('returns null multi_auth for a non-payment consent', async () => {
    const { app } = appWith()
    const res = await app.request(`/consents/${plainConsent.consent_id}:admin`, { headers: care() })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { data: Wire }).data.multi_auth ?? null).toBeNull()
  })

  it('404 for an unknown consent id (audited)', async () => {
    const { app, audit } = appWith()
    const res = await app.request('/consents/4d2c2e2a-0000-4000-8000-000000000000:admin', { headers: care() })
    expect(res.status).toBe(404)
    expect(audit.events.some((e) => e.event_type === 'consent_admin_view')).toBe(true)
  })

  it('rejects a persona without consents:admin (403)', async () => {
    const { app } = appWith()
    const res = await app.request(`/consents/${paymentConsent.consent_id}:admin`, {
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst' }
    })
    expect(res.status).toBe(403)
  })
})
