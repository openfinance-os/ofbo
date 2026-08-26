import { describe, expect, it, vi } from 'vitest'
import { createEInvoicingAspAdapter } from '../src/index.js'

const trace = { trace_id: '4d2c2e2a-0000-4000-8000-000000000000' }
const document = {
  document_id: 'INV-2026-06-TPP-A',
  document_type: '380' as const,
  customization_id: 'urn:peppol:pint:billing-1@ae-1' as const,
  profile_id: 'urn:peppol:bis:billing' as const,
  mode: 'voluntary_pilot' as const,
  xml: '<Invoice />',
  pdf: new TextEncoder().encode('%PDF-1.4 synthetic')
}

describe('P11 enterprise ASP adapter', () => {
  it('posts the canonical payload with correlation and idempotency headers', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      accepted: true,
      submission_ref: 'asp-live-001',
      document_status: 'accepted',
      tdd_status: 'reported'
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const adapter = createEInvoicingAspAdapter({
      baseUrl: 'https://asp.example.test/',
      getToken: async () => 'bank-token',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    await expect(adapter.submitDocument(document, trace)).resolves.toMatchObject({
      submission_ref: 'asp-live-001',
      tdd_status: 'reported'
    })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://asp.example.test/pint-ae/documents')
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer bank-token',
      'x-fapi-interaction-id': trace.trace_id,
      'idempotency-key': document.document_id
    })
    expect(JSON.parse(String(init?.body))).toMatchObject({
      document_id: document.document_id,
      document_type: '380',
      pdf_base64: expect.any(String)
    })
  })

  it('is fail-closed and classifies retryable transport failures', async () => {
    expect(() => createEInvoicingAspAdapter()).toThrow(/fail-closed/)
    const adapter = createEInvoicingAspAdapter({
      baseUrl: 'https://asp.example.test',
      getToken: async () => 'token',
      fetchImpl: async () => new Response('busy', { status: 503 })
    })
    await expect(adapter.submitDocument(document, trace)).rejects.toMatchObject({
      status: 503,
      retryable: true
    })
  })

  it('rejects malformed acknowledgements instead of inventing ASP/TDD state', async () => {
    const adapter = createEInvoicingAspAdapter({
      baseUrl: 'https://asp.example.test',
      getToken: async () => 'token',
      fetchImpl: async () => new Response('{}', { status: 200 })
    })
    await expect(adapter.submitDocument(document, trace)).rejects.toThrow(/invalid response/)
  })
})
