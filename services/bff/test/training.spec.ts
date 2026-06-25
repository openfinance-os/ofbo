import { describe, expect, it } from 'vitest'
import { getAdapter } from '@ofbo/ports'
import { createApp } from '../src/app.js'
import { type HighClassAuditEvent } from '../src/high-class-audit.js'
import { InMemoryAuthAuditSink, type AuthAuditEvent } from '../src/auth.js'
import { TrainingHighClassAuditSink, sandboxTrainingEgress } from '../src/training/environment.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-59 — Training environment for Customer Care. The environment is a SEPARATE app
 * composition: synthetic-PSU dataset (distinct seed), a training-only audit sink (never the
 * production audit_high_sensitivity writer), and a sandbox egress. These tests pin the two
 * acceptance criteria — a separate-but-shape-mirrored dataset, and training actions that never
 * touch the production audit — plus the sandbox egress + TRAINING marker.
 */

const idp = getAdapter('p2-identity-provider', 'demo')

const care = (extra: Record<string, string> = {}) => ({
  ...FAPI_HEADERS,
  authorization: 'Bearer demo-token:customer-care-agent', // consents:admin, disputes:admin, audit:read
  ...extra
})

const search = (app: ReturnType<typeof createApp>, id = 'cust-0001') =>
  app.request(`/consents:search-psu?identifier_type=bank_customer_id&identifier=${id}`, { headers: care() })

/** A sink that is BOTH an auth-audit sink and a High-class emitter — i.e. the shape of the
 *  production PgAuditEmitter the worker passes as `audit` (createApp reuses it for High-class
 *  audit via hasHighClassEmit). Lets us prove training never routes to that production path. */
function combinedProdSink() {
  const auth = new InMemoryAuthAuditSink()
  const highClass: HighClassAuditEvent[] = []
  const sink: AuthAuditSinkWithEmit = {
    async record(e: AuthAuditEvent) {
      await auth.record(e)
    },
    async emit(e: HighClassAuditEvent) {
      highClass.push(e)
    },
    events: auth.events,
    highClass
  }
  return sink
}
type AuthAuditSinkWithEmit = {
  record(e: AuthAuditEvent): Promise<void>
  emit(e: HighClassAuditEvent): Promise<void>
  events: AuthAuditEvent[]
  highClass: HighClassAuditEvent[]
}

describe('BACKOFFICE-59 — training environment', () => {
  it('serves a synthetic-PSU dataset that mirrors production shape but is a SEPARATE set', async () => {
    const prod = createApp({ idp })
    const training = createApp({ idp, training: true })

    const [pRes, tRes] = [await search(prod), await search(training)]
    expect(pRes.status).toBe(200) // same endpoint, same shape — mirrors production
    expect(tRes.status).toBe(200)

    const pBody = (await pRes.json()) as { data: unknown }
    const tBody = (await tRes.json()) as { data: unknown }
    // Same bank_customer_id resolves in both (shape mirrored) ...
    expect((pBody.data as { psu: { bank_customer_id: string } }).psu.bank_customer_id).toBe('cust-0001')
    expect((tBody.data as { psu: { bank_customer_id: string } }).psu.bank_customer_id).toBe('cust-0001')
    // ... but the records differ (distinct seed) — a trainee never acts on a real operator's PSU.
    expect(JSON.stringify(tBody.data)).not.toBe(JSON.stringify(pBody.data))
  })

  it('NEVER routes a training action to the production High-class audit (the load-bearing isolation)', async () => {
    // training:true with a production-shaped emitter passed as `audit`: the High-class reuse
    // path (hasHighClassEmit) must be SUPPRESSED so training events cannot reach it.
    const prodSink = combinedProdSink()
    const training = createApp({ idp, training: true, audit: prodSink })
    expect((await search(training)).status).toBe(200)
    expect(prodSink.highClass).toHaveLength(0) // not one training event reached the production emitter
  })

  it('in PRODUCTION the same emitter DOES receive the High-class audit (proves training suppresses it)', async () => {
    const prodSink = combinedProdSink()
    const prod = createApp({ idp, audit: prodSink }) // training:false
    expect((await search(prod)).status).toBe(200)
    expect(prodSink.highClass.length).toBeGreaterThan(0) // the reuse path is real — training is what disables it
  })

  it('stamps training:true on the training audit and keeps it in a training-only sink', async () => {
    const trainSink = new TrainingHighClassAuditSink()
    const training = createApp({ idp, training: true, highClassAudit: trainSink })
    expect((await search(training)).status).toBe(200)
    expect(trainSink.events.length).toBeGreaterThan(0)
    expect(trainSink.events.every((e) => e.training === true)).toBe(true)
  })

  it('marks every training response with x-ofbo-environment=training; production sets no such header', async () => {
    const training = createApp({ idp, training: true })
    const prod = createApp({ idp })
    expect((await search(training)).headers.get('x-ofbo-environment')).toBe('training')
    expect((await search(prod)).headers.get('x-ofbo-environment')).toBeNull()
  })

  it('sandboxes egress — a practised revoke is acknowledged locally and never propagates (nebras_propagation_ms=0)', async () => {
    const trainSink = new TrainingHighClassAuditSink()
    const training = createApp({ idp, training: true, highClassAudit: trainSink })
    // Take a real consent id from the TRAINING dataset.
    const body = (await (await search(training)).json()) as { data: { consents: { consent_id: string }[] } }
    const consentId = body.data.consents[0]!.consent_id
    const res = await training.request(`/consents/${consentId}:revoke-admin`, {
      method: 'POST',
      headers: care({ 'content-type': 'application/json', 'idempotency-key': 'train-rev-1' }),
      body: JSON.stringify({ reason_code: 'CLIENT_INSTRUCTION' })
    })
    expect(res.status).toBe(200)
    const out = (await res.json()) as { data: { nebras_propagation_ms: number } }
    expect(out.data.nebras_propagation_ms).toBe(0) // sandbox signature — nothing left the environment
    // The revoke audited to the training sink, never production.
    expect(trainSink.events.some((e) => e.event_type.includes('revoke') || e.target_consent_id === consentId)).toBe(true)
  })

  it('sandboxTrainingEgress acknowledges deterministically without reaching any real system', async () => {
    const egress = sandboxTrainingEgress()
    expect((await egress.revokeConsent('c', 'CLIENT_INSTRUCTION', { trace_id: 't' })).acknowledged_in_ms).toBe(0)
    expect((await egress.createDisputeCase({}, { trace_id: 't' })).nebras_case_id).toBe('training-sandbox-case')
    expect(['ACCC', 'ACSP', 'ACSC', 'RJCT', 'PDNG']).toContain((await egress.dispatchRefund('c', { amount: 1, currency: 'AED' }, { trace_id: 't' })).ipp_status)
  })
})
