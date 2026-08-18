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


describe('BILL-14 hard-stop review findings on #320', () => {
  function upload(file: File, verifiedBy = 'finance.reviewer', period = '2026-06') {
    const fd = new FormData()
    fd.set('file', file)
    fd.set('document_type', 'nebras_tax_invoice')
    fd.set('billing_period', period)
    fd.set('verified_by', verifiedBy)
    return fd
  }

  it('does NOT echo the uploaded file back in the unparseable-JSON error', async () => {
    // JSON.parse embeds a snippet of the source in its message, and this parse runs BEFORE redaction.
    // Passing it through would carry raw provider bytes into the error envelope and anything
    // downstream that records it — the exact content this story exists to redact.
    // The leak needs the parse to fail at position 0: Node then embeds a 10-character snippet of the
    // SOURCE in the message ("AE00000000"... is not valid JSON), rather than reporting a position.
    // An earlier version of this test used a mid-document failure, which reports a position only — so
    // it passed whether or not the fix was present, and proved nothing.
    const app = harness()
    const bad = new File(['AE000000000000000000000 is a customer IBAN'], 'x.json', { type: 'application/json' })
    const response = await app.request('/back-office/billing/tpp-cost-documents', {
      method: 'POST',
      headers: { ...financeHeaders, 'idempotency-key': randomUUID() },
      body: upload(bad)
    })
    expect(response.status).toBe(422)
    const raw = await response.text()
    // Assert on the DANGEROUS content only: the source snippet Node embeds, and the parser's own
    // wording that carries it. The safe replacement message deliberately says "is not valid JSON"
    // itself, so asserting on that phrase would match the fix rather than the leak.
    expect(raw).not.toContain('AE00000000')
    expect(raw).not.toContain('Unexpected token')
  })

  it('does NOT echo the provider billing_period in its refusal', async () => {
    // The one parser refusal that reflected a provider-supplied string back across the API boundary.
    const app = harness()
    const file = fileFor(`NEB-${randomUUID()}`, { billing_period: 'AE000000000000000000000' })
    const response = await app.request('/back-office/billing/tpp-cost-documents', {
      method: 'POST',
      headers: { ...financeHeaders, 'idempotency-key': randomUUID() },
      body: upload(file)
    })
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(await response.text()).not.toContain('AE000000000000000000000')
  })

  it('does not replay when the same bytes arrive under the same key with a different verified_by', async () => {
    // verified_by is the endpoint's second-person evidence. Keying the replay on bytes alone replayed
    // the first response, telling the caller their verifier had been recorded when the first one was.
    const app = harness()
    const key = randomUUID()
    const reference = `NEB-${randomUUID()}`

    const first = await app.request('/back-office/billing/tpp-cost-documents', {
      method: 'POST',
      headers: { ...financeHeaders, 'idempotency-key': key },
      body: upload(fileFor(reference), 'first.verifier')
    })
    expect(first.status).toBe(201)
    expect((await first.json() as { data: Record<string, unknown> }).data.verified_by).toBe('first.verifier')

    const second = await app.request('/back-office/billing/tpp-cost-documents', {
      method: 'POST',
      headers: { ...financeHeaders, 'idempotency-key': key },
      body: upload(fileFor(reference), 'second.verifier')
    })
    // Reaches the store rather than replaying, and the store reports the document already exists.
    expect(second.status).toBe(200)
  })
})
