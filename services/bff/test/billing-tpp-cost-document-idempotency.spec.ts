import { randomUUID } from 'node:crypto'
import { getAdapter } from '@ofbo/ports'
import { BillingTppCostDocumentConflictError } from '@ofbo/db'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import type { RawDocumentArchive, TppCostDocumentStore } from '../src/billing/tpp-cost-document.js'

/**
 * BILL-14 — two findings from the contract-conformance reviewer on PR #320.
 *
 * Both are the same shape: a response that reads as authoritative while describing something other
 * than what the ledger holds. That matters more here than on most endpoints, because these tables are
 * INSERT-only with no deletion path — a caller who believes a document was stored has no way to learn
 * otherwise from the response, and no way to undo it later.
 */

const financeHeaders = {
  'x-fapi-interaction-id': randomUUID(),
  authorization: 'Bearer demo-token:finance-analyst@alpha-bank'
}

function invoiceBody(reference: string, overrides: Record<string, unknown> = {}) {
  return {
    invoice_number: reference,
    billing_period: '2026-06',
    currency: 'AED',
    issuer: { id: 'NEBRAS', trn: '100123456700003' },
    recipient: { id: 'bank-as-tpp', trn: '100987654300003' },
    issued_at: '2026-07-03T00:00:00.000Z',
    sections: [{
      name: 'Service Initiation',
      vat_treatment: 'exclusive',
      lines: [{ line_ref: 'SI-1', category: 'Payment Initiation', units: 1000, unit_price_fils: 2.5 }]
    }],
    ...overrides
  }
}

function fileFor(reference: string, overrides: Record<string, unknown> = {}) {
  return new File([JSON.stringify(invoiceBody(reference, overrides))], 'invoice.json', { type: 'application/json' })
}

function post(app: ReturnType<typeof createApp>, file: File, idempotencyKey: string) {
  const fd = new FormData()
  fd.set('file', file)
  fd.set('document_type', 'nebras_tax_invoice')
  fd.set('billing_period', '2026-06')
  fd.set('verified_by', 'finance.reviewer')
  return app.request('/back-office/billing/tpp-cost-documents', {
    method: 'POST',
    headers: { ...financeHeaders, 'idempotency-key': idempotencyKey },
    body: fd
  })
}

/**
 * Models BOTH unique keys the real store enforces: the idempotency key, and (issuer, reference).
 * A fake that only deduped on the reference would let the route's replay bug pass unnoticed, which is
 * exactly how it survived the first round of tests.
 */
function harness() {
  const byReference = new Map<string, { id: string; evidence: string; documentType: string; recipientId: string; issuedAt: string }>()
  const byIdempotencyKey = new Map<string, string>()

  const store: TppCostDocumentStore = {
    async saveDocument(input) {
      const doc = input.document
      const evidence = JSON.stringify({
        reference: doc.documentReference,
        issuer: doc.issuerId,
        period: doc.billingPeriod,
        totals: [doc.netMilliFils, doc.vatMilliFils, doc.grossMilliFils]
      })
      const seenEvidence = byIdempotencyKey.get(input.idempotencyKey)
      if (seenEvidence !== undefined && seenEvidence !== evidence) {
        throw new BillingTppCostDocumentConflictError(
          `idempotency key ${input.idempotencyKey} was already used for a different document`
        )
      }
      const key = `${doc.issuerId}/${doc.documentReference}`
      const existing = byReference.get(key)
      if (existing) {
        byIdempotencyKey.set(input.idempotencyKey, evidence)
        return {
          record: {
            id: existing.id,
            documentReference: doc.documentReference,
            documentType: existing.documentType,
            recipientId: existing.recipientId,
            issuedAt: existing.issuedAt
          },
          created: false
        }
      }
      const id = randomUUID()
      byReference.set(key, {
        id, evidence, documentType: doc.documentType, recipientId: doc.recipientId, issuedAt: doc.issuedAt
      })
      byIdempotencyKey.set(input.idempotencyKey, evidence)
      return { record: { id, documentReference: doc.documentReference }, created: true }
    },
    async documentsForPeriod() { return [] }
  }
  const archive: RawDocumentArchive = { async put(input) { return { ref: `archive://${input.reference}` } } }
  return createApp({
    idp: getAdapter('p2-identity-provider', 'demo'),
    tppCostDocumentStore: store,
    rawDocumentArchive: archive,
    highClassAudit: new InMemoryHighClassAuditSink()
  })
}

describe('BILL-14 Idempotency-Key reuse across DIFFERENT documents', () => {
  it('is a conflict, not a replay of the first document', async () => {
    // The store always refused this. The ROUTE never reached it: `replayable` consults the cache
    // before the handler runs, so the second document was answered with the first document's 201 —
    // telling the caller their document was accepted when nothing had been stored.
    const app = harness()
    const key = randomUUID()

    const first = await post(app, fileFor(`NEB-${randomUUID()}`), key)
    expect(first.status).toBe(201)

    const second = await post(app, fileFor(`NEB-${randomUUID()}`), key)
    expect(second.status).toBe(409)
  })

  it('still replays the original 201 for the same key and the same bytes', async () => {
    // The contract promises a repeated first ingest replays its 201, status included, so the fix must
    // not turn an honest replay into a 200 or a conflict.
    const app = harness()
    const key = randomUUID()
    const reference = `NEB-${randomUUID()}`

    expect((await post(app, fileFor(reference), key)).status).toBe(201)
    expect((await post(app, fileFor(reference), key)).status).toBe(201)
  })
})

describe('BILL-14 the 200 body describes the STORED document', () => {
  it('reports stored values for fields the dedupe hash does not cover', async () => {
    // evidence_hash covers reference, issuer, period, totals and lines — deliberately not issued_at.
    // A re-upload differing only in issued_at is therefore the SAME document to the ledger, takes the
    // 200 path, and previously had its new issued_at echoed back: a value never written anywhere.
    const app = harness()
    const reference = `NEB-${randomUUID()}`

    const first = await post(app, fileFor(reference), randomUUID())
    expect(first.status).toBe(201)
    const stored = await first.json() as { data: Record<string, unknown> }
    expect(stored.data.issued_at).toBe('2026-07-03T00:00:00.000Z')

    const restated = await post(app, fileFor(reference, { issued_at: '2026-07-09T00:00:00.000Z' }), randomUUID())
    expect(restated.status).toBe(200)
    const replayed = await restated.json() as { data: Record<string, unknown> }

    expect(replayed.data.issued_at).toBe(stored.data.issued_at)
    expect(replayed.data.document_type).toBe(stored.data.document_type)
    expect(replayed.data.recipient_id).toBe(stored.data.recipient_id)
  })
})
