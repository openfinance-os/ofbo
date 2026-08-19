import type { EInvoicingAspPort } from '../../interfaces.js'

export interface EInvoicingAspConfig {
  baseUrl?: string
  getToken?: (trace: { trace_id: string }) => Promise<string>
  fetchImpl?: typeof fetch
}

export class EInvoicingAspError extends Error {
  constructor(readonly status: number, readonly retryable: boolean, message: string) {
    super(message)
    this.name = 'EInvoicingAspError'
  }
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]!)
  return btoa(binary)
}

export function createEInvoicingAspAdapter(config: EInvoicingAspConfig = {}): EInvoicingAspPort {
  if (!config.baseUrl) throw new EInvoicingAspError(0, false, 'e-invoicing ASP baseUrl is required (fail-closed)')
  if (!config.getToken) throw new EInvoicingAspError(0, false, 'e-invoicing ASP getToken is required')
  const baseUrl = config.baseUrl.replace(/\/$/, '')
  const getToken = config.getToken
  const doFetch = config.fetchImpl ?? globalThis.fetch

  return {
    async submitDocument(document, trace) {
      const response = await doFetch(`${baseUrl}/pint-ae/documents`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${await getToken(trace)}`,
          'x-fapi-interaction-id': trace.trace_id,
          'idempotency-key': document.document_id
        },
        body: JSON.stringify({
          document_id: document.document_id,
          document_type: document.document_type,
          customization_id: document.customization_id,
          profile_id: document.profile_id,
          mode: document.mode,
          xml: document.xml,
          pdf_base64: base64(document.pdf)
        })
      })
      if (!response.ok) {
        throw new EInvoicingAspError(response.status, response.status === 429 || response.status >= 500, `e-invoicing ASP submission → ${response.status}`)
      }
      const body = await response.json() as {
        accepted?: boolean
        submission_ref?: string
        document_status?: string
        tdd_status?: string
      }
      if (typeof body.accepted !== 'boolean' || !body.submission_ref
        || !['accepted', 'rejected'].includes(body.document_status ?? '')
        || !['reported', 'pending', 'rejected'].includes(body.tdd_status ?? '')) {
        throw new EInvoicingAspError(0, false, 'e-invoicing ASP returned an invalid response')
      }
      return body as Awaited<ReturnType<EInvoicingAspPort['submitDocument']>>
    }
  }
}

export function eInvoicingAspFromEnv(env: NodeJS.ProcessEnv = process.env): EInvoicingAspPort {
  const token = env.EINVOICING_ASP_TOKEN
  if (!env.EINVOICING_ASP_URL || !token) {
    throw new EInvoicingAspError(0, false, 'e-invoicing ASP adapter misconfigured: set EINVOICING_ASP_URL and EINVOICING_ASP_TOKEN')
  }
  return createEInvoicingAspAdapter({ baseUrl: env.EINVOICING_ASP_URL, getToken: async () => token })
}
