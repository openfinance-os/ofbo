import { describe, expect, it } from 'vitest'
import { getAdapter, type OtelSpan } from '@ofbo/ports'
import { createApp } from '../src/app.js'
import { redactingLog } from '../src/telemetry.js'
import { FAPI_HEADERS, AUTHED_HEADERS, FIXED_UUID } from './helpers.js'

const idp = getAdapter('p2-identity-provider', 'demo')

function build() {
  const spans: OtelSpan[] = []
  const apm = {
    exportSpans: async (batch: OtelSpan[]) => {
      spans.push(...batch)
    }
  }
  const app = createApp({ idp, apm })
  return { app, spans }
}

describe('BACKOFFICE-48 — OTel emission, x-fapi-interaction-id end-to-end', () => {
  it('emits one span per request with the fapi header as trace id', async () => {
    const { app, spans } = build()
    await app.request('/back-office/reconciliation/runs', { headers: AUTHED_HEADERS })
    expect(spans).toHaveLength(1)
    expect(spans[0]!.trace_id).toBe(FIXED_UUID)
    expect(spans[0]!.span_id).toBeTruthy()
    expect(spans[0]!.end_time >= spans[0]!.start_time).toBe(true)
  })

  it('records the ROUTE TEMPLATE, never the concrete path (no identifiers in telemetry)', async () => {
    const { app, spans } = build()
    await app.request(`/consents/${FIXED_UUID}:revoke-admin`, {
      method: 'POST',
      headers: { ...AUTHED_HEADERS, 'idempotency-key': FIXED_UUID }
    })
    expect(spans[0]!.attributes['http.route']).toBe('/consents/{consent_id}:revoke-admin')
    expect(JSON.stringify(spans[0]!.attributes)).not.toContain(FIXED_UUID)
  })

  it('marks 2xx/501 spans ok and 4xx auth failures as error with the status code attribute', async () => {
    const { app, spans } = build()
    await app.request('/back-office/analytics/onboarding-handover-health', { headers: AUTHED_HEADERS }) // 501 stub — instrumented, not an app error
    await app.request('/back-office/analytics/onboarding-handover-health', { headers: FAPI_HEADERS }) // 401
    expect(spans[0]!.attributes['http.status_code']).toBe(501)
    expect(spans[0]!.status_code).toBe('ok')
    expect(spans[1]!.attributes['http.status_code']).toBe(401)
    expect(spans[1]!.status_code).toBe('error')
  })

  it('still emits a span when the fapi header is missing (trace_id=untraced, 400 recorded)', async () => {
    const { app, spans } = build()
    await app.request('/back-office/reconciliation/runs')
    expect(spans).toHaveLength(1)
    expect(spans[0]!.trace_id).toBe('untraced')
    expect(spans[0]!.attributes['http.status_code']).toBe(400)
  })

  it('unknown routes are spanned under a bounded name (no attacker-controlled cardinality)', async () => {
    const { app, spans } = build()
    await app.request('/not-a-route-with-secret-784-1990', { headers: AUTHED_HEADERS })
    expect(spans[0]!.attributes['http.route']).toBe('UNMATCHED')
    expect(JSON.stringify(spans[0]!)).not.toContain('secret')
  })

  it('redactingLog masks PII shapes before anything reaches the log stream', () => {
    const emiratesId = ['784', '1990', '1234567', '1'].join('-') // assembled at runtime
    const lines: string[] = []
    redactingLog((l) => lines.push(l))('lookup', { trace_id: 't-1', note: `id ${emiratesId}` })
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain(emiratesId)
    expect(lines[0]).toContain('[REDACTED:emirates_id]')
    expect(lines[0]).toContain('t-1')
  })
})
