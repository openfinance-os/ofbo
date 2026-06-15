import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { generateDemoDataset } from '@ofbo/synthetic-data'
import type { ComplianceReportCreateInput, StoredComplianceReport } from '@ofbo/db'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import type { ComplianceReportStore } from '../src/inquiries/bundle.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-23 — per-PSU CBUAE inquiry bundle. 202 + Report; aggregates the
 * PSU's consents/payments/CoP/disputes/24-mo trail with line-level integrity
 * hashes; compliance:reports:generate enforced.
 */

const psu = generateDemoDataset().psus[0]!

/** Captures the persisted bundle so the line-level hashes can be asserted (they
 *  are not on the wire — the wire is the report metadata). */
class CapturingReportStore implements ComplianceReportStore {
  created: ComplianceReportCreateInput[] = []
  async create(input: ComplianceReportCreateInput): Promise<StoredComplianceReport> {
    this.created.push(input)
    return {
      id: 'rep-test-1',
      report_type: input.report_type,
      status: input.status,
      reporting_period_start: input.reporting_period_start,
      reporting_period_end: input.reporting_period_end,
      classification: input.classification ?? 'restricted',
      requested_by: input.requested_by,
      approved_by: null,
      integrity_hash: input.integrity_hash ?? null,
      generated_at: input.generated_at ?? null,
      submitted_at: null,
      created_at: '2026-06-15T00:00:00.000Z'
    }
  }
  async get(): Promise<StoredComplianceReport | null> {
    return null
  }
}

const compliance = (extra: Record<string, string> = {}) => ({
  ...FAPI_HEADERS,
  authorization: 'Bearer demo-token:compliance-officer',
  'content-type': 'application/json',
  ...extra
})

function appWith() {
  const audit = new InMemoryHighClassAuditSink()
  const reports = new CapturingReportStore()
  return { app: createApp({ complianceReportStore: reports, highClassAudit: audit }), audit, reports }
}

const reqBody = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ psu_identifier_type: 'bank_customer_id', psu_identifier: psu.bank_customer_id, ...over })

describe('POST /back-office/inquiries/psu', () => {
  it('generates a 202 inquiry Report with an integrity hash for a known PSU', async () => {
    const { app } = appWith()
    const res = await app.request('/back-office/inquiries/psu', { method: 'POST', headers: compliance({ 'idempotency-key': 'q1' }), body: reqBody() })
    expect(res.status).toBe(202)
    const body = (await res.json()) as { data: { report_type: string; status: string; integrity_hash: string; generated_at: string } }
    expect(body.data.report_type).toBe('cbuae_psu_inquiry')
    expect(body.data.status).toBe('awaiting_approval')
    expect(body.data.integrity_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(body.data.generated_at).toBeTruthy()
  })

  it('aggregates the sections with a line-level integrity hash per record + one audit', async () => {
    const { app, audit, reports } = appWith()
    await app.request('/back-office/inquiries/psu', { method: 'POST', headers: compliance({ 'idempotency-key': 'q2' }), body: reqBody() })
    const content = reports.created[0]!.content as {
      sections: { consents: unknown[]; payments: unknown[] }
      line_hashes: { consents: string[]; payments: string[] }
    }
    // a hash per consent and per payment (24-mo trail + disputes may be empty in the demo)
    expect(content.line_hashes.consents).toHaveLength(psu.consents.length)
    expect(content.line_hashes.payments).toHaveLength(psu.payments.length)
    expect(content.line_hashes.consents.every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true)
    // verifiable: re-hashing the PERSISTED line reproduces the stored hash
    const canonical = (v: unknown): string => {
      const norm = (x: unknown): unknown =>
        x === null || typeof x !== 'object'
          ? x
          : Array.isArray(x)
            ? x.map(norm)
            : Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, norm((x as Record<string, unknown>)[k])]))
      return JSON.stringify(norm(v))
    }
    const reHash = createHash('sha256').update(canonical(content.sections.consents[0])).digest('hex')
    expect(reHash).toBe(content.line_hashes.consents[0])
    const ev = audit.events.find((e) => e.event_type === 'inquiry_bundle_generated')
    expect(ev?.target_psu_identifier).toBe(psu.bank_customer_id)
    expect((ev?.request_body as { line_count: number }).line_count).toBeGreaterThan(0)
  })

  it('resolves the PSU by emirates_id too', async () => {
    const { app } = appWith()
    const res = await app.request('/back-office/inquiries/psu', {
      method: 'POST',
      headers: compliance({ 'idempotency-key': 'q3' }),
      body: reqBody({ psu_identifier_type: 'emirates_id', psu_identifier: psu.emirates_id })
    })
    expect(res.status).toBe(202)
  })

  it('400 missing fields / invalid type, 404 unknown PSU, 400 without Idempotency-Key', async () => {
    const { app } = appWith()
    expect((await app.request('/back-office/inquiries/psu', { method: 'POST', headers: compliance({ 'idempotency-key': 'q4' }), body: JSON.stringify({}) })).status).toBe(400)
    expect((await app.request('/back-office/inquiries/psu', { method: 'POST', headers: compliance({ 'idempotency-key': 'q5' }), body: reqBody({ psu_identifier_type: 'passport' }) })).status).toBe(400)
    expect((await app.request('/back-office/inquiries/psu', { method: 'POST', headers: compliance({ 'idempotency-key': 'q6' }), body: reqBody({ psu_identifier: 'cust-9999' }) })).status).toBe(404)
    expect((await app.request('/back-office/inquiries/psu', { method: 'POST', headers: compliance(), body: reqBody() })).status).toBe(400)
  })

  it('rejects a persona without compliance:reports:generate (403)', async () => {
    const { app } = appWith()
    const res = await app.request('/back-office/inquiries/psu', {
      method: 'POST',
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:customer-care-agent', 'content-type': 'application/json', 'idempotency-key': 'q7' },
      body: reqBody()
    })
    expect(res.status).toBe(403)
  })
})
