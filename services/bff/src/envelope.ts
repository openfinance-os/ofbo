/** Binding response envelopes per CLAUDE.md API conventions. */

export interface Meta {
  request_id: string
  timestamp: string
  next_cursor?: string | null
}

function meta(): Meta {
  return { request_id: crypto.randomUUID(), timestamp: new Date().toISOString() }
}

export function dataEnvelope<T>(data: T, extra?: Partial<Meta>) {
  return { data, meta: { ...meta(), ...extra } }
}

export function errorEnvelope(
  code: string,
  message: string,
  remediation: string,
  docsUrl: string,
  extra?: Record<string, string>
) {
  return {
    error: { code, message, remediation, docs_url: docsUrl, ...extra },
    meta: meta()
  }
}

export const DOCS_BASE = 'https://github.com/openfinance-os/ofbo/blob/main/specs/backoffice-openapi.yaml'
