import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-35 — self-service periodic report generation. Templates → generate
 * (CBUAE-bound = four-eyes awaiting_approval; non-CBUAE = ready); Programme Manager
 * approves (initiator ≠ approver); submit after manual upload; download with integrity hash.
 */

const auth = (persona: string, extra: Record<string, string> = {}) => ({ ...FAPI_HEADERS, authorization: `Bearer demo-token:${persona}`, ...extra })
const PERIOD = { period_start: '2026-05-01', period_end: '2026-05-31' }

describe('Report generation — lifecycle + four-eyes (HTTP)', () => {
  it('non-CBUAE report generates ready (approved) immediately', async () => {
    const app = createApp()
    const res = await app.request('/back-office/reports:generate', {
      method: 'POST',
      headers: auth('compliance-officer', { 'content-type': 'application/json', 'idempotency-key': 'g1' }),
      body: JSON.stringify({ report_type: 'internal_consent_volume', ...PERIOD })
    })
    expect(res.status).toBe(202)
    const body = (await res.json()) as { data: { id: string; status: string; integrity_hash: string } }
    expect(body.data.status).toBe('approved') // no four-eyes for internal reports
    expect(body.data.integrity_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('CBUAE-bound report is four-eyes: awaiting_approval → Programme Manager approves → approved → submitted', async () => {
    const app = createApp()
    const gen = await app.request('/back-office/reports:generate', {
      method: 'POST',
      headers: auth('compliance-officer', { 'content-type': 'application/json', 'idempotency-key': 'g2' }),
      body: JSON.stringify({ report_type: 'cbuae_monthly', ...PERIOD })
    })
    expect(gen.status).toBe(202)
    const report = (await gen.json()) as { data: { id: string; status: string } }
    expect(report.data.status).toBe('awaiting_approval')
    const id = report.data.id

    // the initiator (compliance-officer) lacks programme:read → 403 at the middleware
    const selfTry = await app.request(`/back-office/reports/${id}:approve`, { method: 'POST', headers: auth('compliance-officer', { 'idempotency-key': 'a0' }) })
    expect(selfTry.status).toBe(403)

    // a Programme Manager (programme:read), a different principal, approves
    const appr = await app.request(`/back-office/reports/${id}:approve`, { method: 'POST', headers: auth('programme-manager', { 'idempotency-key': 'a1' }) })
    expect(appr.status).toBe(200)
    expect(((await appr.json()) as { data: { status: string; approved_by: string } }).data.status).toBe('approved')

    // submit after the manual upload (compliance:reports:generate)
    const sub = await app.request(`/back-office/reports/${id}:submit`, { method: 'POST', headers: auth('compliance-officer', { 'idempotency-key': 's1' }) })
    expect(sub.status).toBe(200)
    expect(((await sub.json()) as { data: { status: string; submitted_at: string } }).data.status).toBe('submitted')
  })

  it('super-admin cannot self-approve its own CBUAE report (four-eyes, even for the marker scope)', async () => {
    const app = createApp()
    const sa = auth('platform-super-admin', { 'x-superadmin-justification': 'demo walkthrough of the report four-eyes control' })
    const gen = await app.request('/back-office/reports:generate', { method: 'POST', headers: { ...sa, 'content-type': 'application/json', 'idempotency-key': 'g3' }, body: JSON.stringify({ report_type: 'cbuae_quarterly', ...PERIOD }) })
    const id = ((await gen.json()) as { data: { id: string } }).data.id
    const selfApprove = await app.request(`/back-office/reports/${id}:approve`, { method: 'POST', headers: { ...sa, 'idempotency-key': 'a2' } })
    expect(selfApprove.status).toBe(409) // BACKOFFICE.SELF_APPROVAL
  })

  it('rejects unknown template (400), invalid period (400), missing Idempotency-Key (400), wrong scope (403)', async () => {
    const app = createApp()
    expect((await app.request('/back-office/reports:generate', { method: 'POST', headers: auth('compliance-officer', { 'content-type': 'application/json', 'idempotency-key': 'b1' }), body: JSON.stringify({ report_type: 'nope', ...PERIOD }) })).status).toBe(400)
    expect((await app.request('/back-office/reports:generate', { method: 'POST', headers: auth('compliance-officer', { 'content-type': 'application/json', 'idempotency-key': 'b2' }), body: JSON.stringify({ report_type: 'cbuae_monthly', period_start: '2026-05-31', period_end: '2026-05-01' }) })).status).toBe(400)
    expect((await app.request('/back-office/reports:generate', { method: 'POST', headers: auth('compliance-officer', { 'content-type': 'application/json' }), body: JSON.stringify({ report_type: 'cbuae_monthly', ...PERIOD }) })).status).toBe(400)
    expect((await app.request('/back-office/reports:generate', { method: 'POST', headers: auth('customer-care-agent', { 'content-type': 'application/json', 'idempotency-key': 'b3' }), body: JSON.stringify({ report_type: 'cbuae_monthly', ...PERIOD }) })).status).toBe(403)
  })

  it('list (read scope) + download with X-Content-SHA256; submit blocked before approval (409)', async () => {
    const app = createApp()
    const gen = await app.request('/back-office/reports:generate', { method: 'POST', headers: auth('compliance-officer', { 'content-type': 'application/json', 'idempotency-key': 'g4' }), body: JSON.stringify({ report_type: 'cbuae_monthly', ...PERIOD }) })
    const id = ((await gen.json()) as { data: { id: string } }).data.id

    // submit before approval → 409
    expect((await app.request(`/back-office/reports/${id}:submit`, { method: 'POST', headers: auth('compliance-officer', { 'idempotency-key': 's2' }) })).status).toBe(409)

    // list is compliance:reports:read
    const list = await app.request('/back-office/reports', { headers: auth('compliance-officer') })
    expect(list.status).toBe(200)
    expect(((await list.json()) as { data: unknown[] }).data.length).toBeGreaterThan(0)

    // download returns bytes + integrity-hash header
    const dl = await app.request(`/back-office/reports/${id}/download?format=pdf`, { headers: auth('compliance-officer') })
    expect(dl.status).toBe(200)
    expect(dl.headers.get('x-content-sha256')).toMatch(/^[0-9a-f]{64}$/)
    expect((await dl.arrayBuffer()).byteLength).toBeGreaterThan(0)

    // 404 unknown report
    expect((await app.request('/back-office/reports/4d2c2e2a-0000-4000-8000-000000000000', { headers: auth('compliance-officer') })).status).toBe(404)
  })
})
