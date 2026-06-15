import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-41 — analytics exports (PDF/XLSX/CSV): 202 + a ComplianceReport-shaped
 * receipt with a SHA-256 integrity hash; the requester identity is High-class
 * audited; the per-view scope ("(scope of the exported view)") is enforced.
 */

const hdr = (persona: string, extra: Record<string, string> = {}) => ({ ...FAPI_HEADERS, authorization: `Bearer demo-token:${persona}`, 'content-type': 'application/json', ...extra })

function harness() {
  const audit = new InMemoryHighClassAuditSink()
  return { app: createApp({ highClassAudit: audit }), audit }
}

const exportReq = (app: ReturnType<typeof createApp>, persona: string, body: unknown, key: string) =>
  app.request('/back-office/analytics/exports', { method: 'POST', headers: hdr(persona, { 'idempotency-key': key }), body: JSON.stringify(body) })

describe('POST /back-office/analytics/exports (BACKOFFICE-41)', () => {
  it('exports a view (202), returns a ComplianceReport with an integrity hash, and audits the requester', async () => {
    const { app, audit } = harness()
    const res = await exportReq(app, 'risk-analyst', { view: 'risk-view', format: 'csv' }, 'e1')
    expect(res.status).toBe(202)
    const body = (await res.json()) as { data: { report_type: string; status: string; integrity_hash: string; requested_by: string; generated_at: string } }
    expect(body.data.report_type).toBe('analytics_export:risk-view:csv')
    expect(body.data.status).toBe('archived')
    expect(body.data.integrity_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(body.data.requested_by).toBeTruthy()

    const ev = audit.events.find((e) => e.event_type === 'analytics_export')
    expect(ev).toBeTruthy()
    const rb = ev!.request_body as { view: string; format: string; integrity_hash: string; byte_length: number }
    expect(rb.view).toBe('risk-view')
    expect(rb.format).toBe('csv')
    expect(rb.integrity_hash).toBe(body.data.integrity_hash)
    expect(rb.byte_length).toBeGreaterThan(0)
  })

  it('enforces the per-view scope (403 when the persona lacks the view scope; 202 when it holds it)', async () => {
    const { app } = harness()
    // finance-analyst lacks risk:read → cannot export the Risk View
    expect((await exportReq(app, 'finance-analyst', { view: 'risk-view', format: 'csv' }, 's1')).status).toBe(403)
    // finance-analyst holds reconciliation:read → can export the Finance View
    expect((await exportReq(app, 'finance-analyst', { view: 'finance-view', format: 'csv' }, 's2')).status).toBe(202)
  })

  it('validates view + format + Idempotency-Key', async () => {
    const { app } = harness()
    expect((await exportReq(app, 'risk-analyst', { view: 'made-up', format: 'csv' }, 'v1')).status).toBe(400)
    expect((await exportReq(app, 'risk-analyst', { view: 'risk-view', format: 'docx' }, 'v2')).status).toBe(400)
    const noKey = await app.request('/back-office/analytics/exports', { method: 'POST', headers: hdr('risk-analyst'), body: JSON.stringify({ view: 'risk-view', format: 'csv' }) })
    expect(noKey.status).toBe(400)
  })

  it('replays the same Idempotency-Key verbatim (no second export audit)', async () => {
    const { app, audit } = harness()
    await exportReq(app, 'risk-analyst', { view: 'risk-view', format: 'csv' }, 'k')
    const before = audit.events.filter((e) => e.event_type === 'analytics_export').length
    const replay = await exportReq(app, 'risk-analyst', { view: 'risk-view', format: 'csv' }, 'k')
    expect(replay.status).toBe(202)
    expect(audit.events.filter((e) => e.event_type === 'analytics_export').length).toBe(before)
  })

  it('produces a different integrity hash per format for the same view', async () => {
    const { app } = harness()
    const csv = (await (await exportReq(app, 'risk-analyst', { view: 'risk-view', format: 'csv' }, 'f1')).json()) as { data: { integrity_hash: string } }
    const pdf = (await (await exportReq(app, 'risk-analyst', { view: 'risk-view', format: 'pdf' }, 'f2')).json()) as { data: { integrity_hash: string } }
    expect(csv.data.integrity_hash).not.toBe(pdf.data.integrity_hash)
  })
})
