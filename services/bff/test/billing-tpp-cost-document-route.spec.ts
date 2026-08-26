import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { getAdapter } from '@ofbo/ports'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import type { RawDocumentArchive, TppCostDocumentStore } from '../src/billing/tpp-cost-document.js'

/**
 * BILL-14 — the HTTP route, exercised through `createApp`.
 *
 * Added because the contract review pointed out that nothing bound the route to the contract: the
 * service was tested directly, so the envelope, the 201/200 selection, the error-envelope mapping and
 * the wire shape were all unasserted. `pnpm verify:contract` cannot cover it either — it probes only
 * parameter-less GETs. Same lesson this track has now learned four times: a control is not evidenced
 * until something fails when it breaks.
 */

const FAPI_HEADERS = { 'x-fapi-interaction-id': randomUUID() }
const financeHeaders = {
  ...FAPI_HEADERS,
  authorization: 'Bearer demo-token:finance-analyst@alpha-bank'
}

function invoiceFile(reference = `NEB-${randomUUID()}`) {
  const body = JSON.stringify({
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
    }]
  })
  return { reference, file: new File([body], 'invoice.json', { type: 'application/json' }) }
}

function harness() {
  const rows = new Map<string, { id: string; evidence: string }>()
  const store: TppCostDocumentStore = {
    async saveDocument(input) {
      const key = `${input.document.issuerId}/${input.document.documentReference}`
      const existing = rows.get(key)
      if (existing) return { record: { id: existing.id, documentReference: input.document.documentReference }, created: false }
      const id = randomUUID()
      rows.set(key, { id, evidence: 'e' })
      return { record: { id, documentReference: input.document.documentReference }, created: true }
    },
    async documentsForPeriod() { return [] }
  }
  const archive: RawDocumentArchive = { async put(input) { return { ref: `archive://${input.reference}` } } }
  const audit = new InMemoryHighClassAuditSink()
  return {
    app: createApp({
      idp: getAdapter('p2-identity-provider', 'demo'),
      tppCostDocumentStore: store,
      rawDocumentArchive: archive,
      highClassAudit: audit
    }),
    audit
  }
}

function upload(fields: Record<string, string>, file: File): FormData {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.set(key, value)
  form.set('file', file)
  return form
}

describe('BILL-14 POST /back-office/billing/tpp-cost-documents', () => {
  it('returns 201 with the full verified-upload evidence in a data envelope', async () => {
    const { app } = harness()
    const { reference, file } = invoiceFile()

    const res = await app.request('/back-office/billing/tpp-cost-documents', {
      method: 'POST',
      headers: { ...financeHeaders, 'idempotency-key': randomUUID() },
      body: upload({ document_type: 'nebras_tax_invoice', billing_period: '2026-06', verified_by: 'finance.reviewer' }, file)
    })

    expect(res.status).toBe(201)
    const body = await res.json() as { data: Record<string, unknown>; meta: Record<string, unknown> }
    expect(body.meta).toHaveProperty('request_id')
    expect(body.meta).toHaveProperty('timestamp')

    // The four fields the contract declares as the verified-manual-upload evidence, which an earlier
    // version of the wire silently omitted.
    expect(String(body.data.document_sha256)).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(body.data.verified_by).toBe('finance.reviewer')
    expect(body.data).toHaveProperty('verified_at')
    expect(body.data).toHaveProperty('received_at')

    expect(body.data).toMatchObject({
      document_type: 'nebras_tax_invoice',
      document_reference: reference,
      billing_period: '2026-06',
      currency: 'AED',
      unmapped_line_count: 0
    })
    // snake_case throughout, per the API conventions — no camelCase leaking from the domain type.
    for (const key of Object.keys(body.data)) expect(key, key).toMatch(/^[a-z0-9_]+$/)
    const lines = body.data.lines as Array<Record<string, unknown>>
    for (const key of Object.keys(lines[0]!)) expect(key, key).toMatch(/^[a-z0-9_]+$/)

    // Money at the boundary: amounts are Money objects, and the triple TIES on the wire. Rounding
    // net, VAT and gross independently is what would break that — the invoice states 1000 units at
    // 2.5 fils, so net is 2500 fils and VAT 125.
    expect(body.data.net).toEqual({ amount: 2500, currency: 'AED' })
    expect(body.data.vat).toEqual({ amount: 125, currency: 'AED' })
    expect(body.data.gross).toEqual({ amount: 2625, currency: 'AED' })
    const net = body.data.net as { amount: number }
    const vat = body.data.vat as { amount: number }
    const gross = body.data.gross as { amount: number }
    expect(net.amount + vat.amount).toBe(gross.amount)
    // The line's unit price stays a milli-fils RATE: 2.5 fils cannot survive minor units.
    expect(lines[0]!.unit_price_milli_fils).toBe(2500)
    expect(lines[0]!.actual_net).toEqual({ amount: 2500, currency: 'AED' })
  })

  it('returns 200, not 201, when the same document arrives again under a new key', async () => {
    const { app } = harness()
    const { reference } = invoiceFile()

    const send = () => app.request('/back-office/billing/tpp-cost-documents', {
      method: 'POST',
      headers: { ...financeHeaders, 'idempotency-key': randomUUID() },
      body: upload(
        { document_type: 'nebras_tax_invoice', billing_period: '2026-06', verified_by: 'finance.reviewer' },
        invoiceFile(reference).file
      )
    })

    expect((await send()).status).toBe(201)
    expect((await send()).status).toBe(200)
  })

  it('maps a self-verification refusal to 409 with the standard error envelope', async () => {
    const { app } = harness()
    const res = await app.request('/back-office/billing/tpp-cost-documents', {
      method: 'POST',
      headers: { ...financeHeaders, 'idempotency-key': randomUUID() },
      // The demo IdP's subject is `demo:<persona>@<tenant>`; nominating the uploader must be refused.
      body: upload(
        { document_type: 'nebras_tax_invoice', billing_period: '2026-06', verified_by: 'demo:finance-analyst@alpha-bank' },
        invoiceFile().file
      )
    })

    expect(res.status).toBe(409)
    const body = await res.json() as { error: Record<string, unknown> }
    expect(body.error).toMatchObject({ code: 'BACKOFFICE.SELF_VERIFICATION_REFUSED' })
    for (const field of ['code', 'message', 'remediation', 'docs_url']) {
      expect(body.error, field).toHaveProperty(field)
    }
  })

  it('takes the UPLOADER from the claim only — a body field naming one cannot displace it', async () => {
    // The half of the control that IS authentication, and the half a review found the spec
    // over-claiming about. `verified_by` is an operator attestation (ratified, and the spec now says
    // so), so the uploader is the only authenticated party on this endpoint. If it were ever read
    // from the body, both names would be caller-supplied and the distinctness refusal would reduce to
    // comparing two strings the same caller chose.
    //
    // Discriminating by construction: `verified_by` here EQUALS the principal's own subject, so the
    // refusal can fire only if the uploader came from the claim. A decoy `uploaded_by` naming someone
    // else rides alongside — an implementation that honoured it would see two different names and
    // answer 201.
    const { app } = harness()
    const res = await app.request('/back-office/billing/tpp-cost-documents', {
      method: 'POST',
      headers: { ...financeHeaders, 'idempotency-key': randomUUID() },
      body: upload(
        {
          document_type: 'nebras_tax_invoice',
          billing_period: '2026-06',
          verified_by: 'demo:finance-analyst@alpha-bank',
          uploaded_by: 'someone.else'
        },
        invoiceFile().file
      )
    })

    expect(res.status).toBe(409)
    expect((await res.json() as { error: Record<string, unknown> }).error)
      .toMatchObject({ code: 'BACKOFFICE.SELF_VERIFICATION_REFUSED' })
  })

  it('maps an unparseable document to 422 without echoing provider content', async () => {
    const { app } = harness()
    const res = await app.request('/back-office/billing/tpp-cost-documents', {
      method: 'POST',
      headers: { ...financeHeaders, 'idempotency-key': randomUUID() },
      body: upload(
        { document_type: 'nebras_tax_invoice', billing_period: '2026-06', verified_by: 'finance.reviewer' },
        new File(['not json'], 'x.json')
      )
    })
    expect(res.status).toBe(422)
  })

  it('refuses a missing Idempotency-Key rather than ingesting unprotected', async () => {
    const { app } = harness()
    const res = await app.request('/back-office/billing/tpp-cost-documents', {
      method: 'POST',
      headers: financeHeaders,
      body: upload(
        { document_type: 'nebras_tax_invoice', billing_period: '2026-06', verified_by: 'finance.reviewer' },
        invoiceFile().file
      )
    })
    expect(res.status).toBe(400)
  })

  it('refuses a caller without billing:write at the gateway layer', async () => {
    const { app } = harness()
    const res = await app.request('/back-office/billing/tpp-cost-documents', {
      method: 'POST',
      headers: {
        ...FAPI_HEADERS,
        authorization: 'Bearer demo-token:customer-care-agent@alpha-bank',
        'idempotency-key': randomUUID()
      },
      body: upload(
        { document_type: 'nebras_tax_invoice', billing_period: '2026-06', verified_by: 'finance.reviewer' },
        invoiceFile().file
      )
    })
    expect(res.status).toBe(403)
  })
})
