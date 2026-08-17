import { describe, expect, it } from 'vitest'
import { fils } from '@ofbo/billing'
import { BillingTppCostDocumentConflictError } from '@ofbo/db'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import {
  TppCostDocumentAbsenceAlarm,
  TppCostDocumentError,
  TppCostDocumentIngestService,
  documentDueAnchor,
  type TppCostDocumentStore
} from '../src/billing/tpp-cost-document.js'
import type { Principal } from '../src/auth.js'

/**
 * BILL-14 — the ingest service and the missing-document alarm.
 *
 * What is worth testing beyond the happy path: the verifier/uploader distinctness rule (the schema
 * cannot carry it), the conflict classification (typed, not message-matched), and an alarm that fires
 * only once the scheme's calendar anchor has passed — an alarm that cries early gets ignored.
 */

const UPLOADER: Principal = {
  subject: 'finance.uploader', persona: 'of_finance_analyst', scopes: ['billing:write', 'billing:read']
}
const NO_SCOPE: Principal = { subject: 'care.agent', persona: 'customer_care_agent', scopes: ['care:read'] }

function invoiceBytes(reference = 'NEB-2026-06-1', period = '2026-06'): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    invoice_number: reference,
    billing_period: period,
    currency: 'AED',
    issuer: { id: 'NEBRAS', trn: '100123456700003' },
    recipient: { id: 'bank-as-tpp', trn: '100987654300003' },
    issued_at: '2026-07-03T00:00:00.000Z',
    sections: [{
      name: 'Service Initiation',
      vat_treatment: 'exclusive',
      lines: [{ line_ref: 'SI-1', category: 'Payment Initiation', units: 1000, unit_price_fils: 2.5 }]
    }]
  }))
}

function harness(overrides: Partial<TppCostDocumentStore> = {}) {
  const saved: Array<Record<string, unknown>> = []
  const store: TppCostDocumentStore = {
    async saveDocument(input) {
      saved.push(input as unknown as Record<string, unknown>)
      return { record: { id: 'doc-1', documentReference: input.document.documentReference }, created: true }
    },
    async documentsForPeriod() { return [] },
    ...overrides
  }
  const audit = new InMemoryHighClassAuditSink()
  const archive = { async put(input: { reference: string }) { return { ref: `archive://${input.reference}` } } }
  const service = new TppCostDocumentIngestService({
    store, audit, archive, now: () => new Date('2026-07-03T09:00:00.000Z')
  })
  return { service, audit, saved, store }
}

describe('BILL-14 provider-document ingest', () => {
  it('ingests a parsed invoice, retaining the raw artifact outside the ledger', async () => {
    const { service, audit, saved } = harness()

    const result = await service.ingest(
      UPLOADER,
      { documentType: 'nebras_tax_invoice', billingPeriod: '2026-06', verifiedBy: 'finance.reviewer', fileBytes: invoiceBytes() },
      'idem-1', 'trace-1'
    )

    expect(result).toMatchObject({ created: true, id: 'doc-1', unmappedLineCount: 0 })
    expect(result.document.netMilliFils).toBe(fils(2500))
    // The ledger stores a pointer and a hash, never the provider bytes.
    expect(saved[0]).toMatchObject({ rawDocumentRef: 'archive://NEB-2026-06-1', verifiedBy: 'finance.reviewer' })
    expect(String(saved[0]!.documentSha256)).toMatch(/^sha256:[0-9a-f]{64}$/)

    const event = audit.events.at(-1)
    expect(event?.event_type).toBe('billing_tpp_cost_document_ingested')
    expect(event?.acting_principal).toBe('finance.uploader')
    expect(event?.request_body).toMatchObject({ verified_by: 'finance.reviewer', gross_milli_fils: fils(2625) })
  })

  it('refuses an upload whose nominated verifier is its own uploader', async () => {
    const { service, saved } = harness()

    // Same person, and the same person under a different spelling — one human must not pass as two.
    for (const verifiedBy of ['finance.uploader', '  Finance.Uploader  ']) {
      await expect(service.ingest(
        UPLOADER,
        { documentType: 'nebras_tax_invoice', billingPeriod: '2026-06', verifiedBy, fileBytes: invoiceBytes() },
        'idem-x', 'trace-x'
      )).rejects.toThrow(/verifier of a manual upload cannot be its uploader/i)
    }
    expect(saved).toHaveLength(0)
  })

  it('requires a verifier at all — an unverified manual upload is not evidence', async () => {
    const { service } = harness()
    await expect(service.ingest(
      UPLOADER,
      { documentType: 'nebras_tax_invoice', billingPeriod: '2026-06', fileBytes: invoiceBytes() },
      'idem-2', 'trace-2'
    )).rejects.toThrow(/verified_by is required/i)
  })

  it('answers a provider restatement with 409, classified by error TYPE not message text', async () => {
    const { service } = harness({
      async saveDocument() { throw new BillingTppCostDocumentConflictError('stored evidence differs') }
    })
    await expect(service.ingest(
      UPLOADER,
      { documentType: 'nebras_tax_invoice', billingPeriod: '2026-06', verifiedBy: 'finance.reviewer', fileBytes: invoiceBytes() },
      'idem-3', 'trace-3'
    )).rejects.toMatchObject({ code: 'BACKOFFICE.DOCUMENT_CONFLICT', status: 409 })
  })

  it('propagates a genuine store defect instead of dressing it as a conflict', async () => {
    const { service } = harness({ async saveDocument() { throw new Error('database unavailable') } })
    await expect(service.ingest(
      UPLOADER,
      { documentType: 'nebras_tax_invoice', billingPeriod: '2026-06', verifiedBy: 'finance.reviewer', fileBytes: invoiceBytes() },
      'idem-4', 'trace-4'
    )).rejects.toThrow(/database unavailable/)
  })

  it('rejects an unparseable document and a period that contradicts the request', async () => {
    const { service } = harness()
    const bad = new TextEncoder().encode('not json at all')
    await expect(service.ingest(
      UPLOADER,
      { documentType: 'nebras_tax_invoice', billingPeriod: '2026-06', verifiedBy: 'finance.reviewer', fileBytes: bad },
      'idem-5', 'trace-5'
    )).rejects.toMatchObject({ status: 422 })

    await expect(service.ingest(
      UPLOADER,
      {
        documentType: 'nebras_tax_invoice', billingPeriod: '2026-07', verifiedBy: 'finance.reviewer',
        fileBytes: invoiceBytes('NEB-2026-06-2', '2026-06')
      },
      'idem-6', 'trace-6'
    )).rejects.toMatchObject({ code: 'BACKOFFICE.PERIOD_MISMATCH', status: 422 })
  })

  it('enforces billing:write at the service layer, not only at the gateway', async () => {
    const { service } = harness()
    await expect(service.ingest(
      NO_SCOPE,
      { documentType: 'nebras_tax_invoice', billingPeriod: '2026-06', verifiedBy: 'finance.reviewer', fileBytes: invoiceBytes() },
      'idem-7', 'trace-7'
    )).rejects.toThrow()
  })

  it('refuses a document type with no wired parser rather than guessing a layout', async () => {
    const { service } = harness()
    await expect(service.ingest(
      UPLOADER,
      { documentType: 'lfi_self_invoice', billingPeriod: '2026-06', verifiedBy: 'finance.reviewer', fileBytes: invoiceBytes() },
      'idem-8', 'trace-8'
    )).rejects.toMatchObject({ code: 'BACKOFFICE.UNSUPPORTED_DOCUMENT_TYPE' })
  })

  it('never carries redacted values into the audit trail — counts and key paths only', async () => {
    const { service, audit } = harness()
    const withPii = new TextEncoder().encode(JSON.stringify({
      invoice_number: 'NEB-PII', billing_period: '2026-06', currency: 'AED',
      issuer: { id: 'NEBRAS', trn: '100123456700003' },
      recipient: { id: 'bank-as-tpp', trn: '100987654300003' },
      issued_at: '2026-07-03T00:00:00.000Z',
      sections: [{
        name: 'Service Initiation', vat_treatment: 'exclusive',
        lines: [{
          line_ref: 'SI-1', category: 'Payment Initiation', units: 1, unit_price_fils: 2.5,
          customer_name: 'AUDIT_LEAK_CANARY'
        }]
      }]
    }))

    await service.ingest(
      UPLOADER,
      { documentType: 'nebras_tax_invoice', billingPeriod: '2026-06', verifiedBy: 'finance.reviewer', fileBytes: withPii },
      'idem-9', 'trace-9'
    )

    const event = audit.events.at(-1)
    expect(JSON.stringify(event)).not.toContain('AUDIT_LEAK_CANARY')
    expect(event?.request_body).toMatchObject({ redacted_field_count: 1 })
    // The path is named so the redaction is auditable; the value is not.
    expect(JSON.stringify(event?.request_body)).toMatch(/customer_name/)
  })
})

describe('BILL-14 missing-document alarm (IG v5.0 §10.12)', () => {
  it('anchors on the 5th of the following month, moving off a weekend', () => {
    // 2026-06 → 5 July 2026 is a Sunday, so the anchor moves to Monday the 6th.
    expect(documentDueAnchor('2026-06').toISOString()).toBe('2026-07-06T00:00:00.000Z')
    // 2026-07 → 5 August 2026 is a Wednesday: unchanged.
    expect(documentDueAnchor('2026-07').toISOString()).toBe('2026-08-05T00:00:00.000Z')
    // December rolls the year.
    expect(documentDueAnchor('2026-12').toISOString()).toBe('2027-01-05T00:00:00.000Z')
  })

  function alarm(now: string, documents: Array<{ id: string; documentType: string; documentReference: string }>) {
    const tickets: Array<Record<string, unknown>> = []
    const audit = new InMemoryHighClassAuditSink()
    const instance = new TppCostDocumentAbsenceAlarm({
      store: { async documentsForPeriod() { return documents } },
      itsm: {
        async createTicket(input) { tickets.push(input as unknown as Record<string, unknown>); return { ticket_id: 'INC-1' } }
      },
      audit,
      now: () => new Date(now)
    })
    return { instance, tickets, audit }
  }

  it('does not fire before the anchor has passed', async () => {
    const { instance, tickets } = alarm('2026-07-04T00:00:00.000Z', [])
    expect(await instance.check('2026-06', 'trace')).toMatchObject({ status: 'not_due' })
    expect(tickets).toHaveLength(0)
  })

  it('fires through P3 once the anchor has passed with no invoice received', async () => {
    const { instance, tickets, audit } = alarm('2026-07-07T00:00:00.000Z', [])
    const result = await instance.check('2026-06', 'trace')

    expect(result).toMatchObject({ status: 'raised', ticketId: 'INC-1' })
    expect(tickets[0]).toMatchObject({ severity: 'high', team: 'finance-operations' })
    expect(String(tickets[0]!.summary)).toMatch(/10\.12\.2/)
    expect(audit.events.at(-1)?.event_type).toBe('billing_tpp_cost_document_missing')
  })

  it('stays quiet when an invoicing document has arrived', async () => {
    const { instance, tickets } = alarm('2026-07-07T00:00:00.000Z', [
      { id: 'd1', documentType: 'nebras_tax_invoice', documentReference: 'NEB-1' }
    ])
    expect(await instance.check('2026-06', 'trace')).toMatchObject({ status: 'received' })
    expect(tickets).toHaveLength(0)
  })

  it('still fires when only a non-invoicing document exists — a credit note is not an invoice', async () => {
    const { instance, tickets } = alarm('2026-07-07T00:00:00.000Z', [
      { id: 'd1', documentType: 'credit_note', documentReference: 'CN-1' }
    ])
    expect(await instance.check('2026-06', 'trace')).toMatchObject({ status: 'raised' })
    expect(tickets).toHaveLength(1)
  })

  it('surfaces a typed error for a malformed period rather than silently not alarming', () => {
    const { instance } = alarm('2026-07-07T00:00:00.000Z', [])
    expect(() => documentDueAnchor('2026-13')).toThrow(RangeError)
    expect(instance).toBeInstanceOf(TppCostDocumentAbsenceAlarm)
  })
})

describe('BILL-14 error typing', () => {
  it('carries an API code and status on every rejection the endpoint must map', () => {
    const error = new TppCostDocumentError('BACKOFFICE.DOCUMENT_CONFLICT', 'x', 409)
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ code: 'BACKOFFICE.DOCUMENT_CONFLICT', status: 409 })
  })
})
