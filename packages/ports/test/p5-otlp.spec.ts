import { describe, expect, it } from 'vitest'
import {
  OtlpApmAdapter,
  otlpApmFromEnv,
  OtlpConfigError,
  type OtlpHttp,
  type OtlpConfig
} from '../src/adapters/enterprise/p5-otlp.js'
import type { OtelSpan } from '../src/interfaces.js'

const span: OtelSpan = {
  name: 'test-span',
  trace_id: '4d2c2e2a-0000-4000-8000-000000000000',
  span_id: 'span-001',
  start_time: 0,
  end_time: 1,
  status_code: 'ok',
  attributes: { 'http.route': '/test', count: 3, ok: true }
}

interface Captured {
  url: string
  headers: Record<string, string>
  body: { resourceSpans: { resource: { attributes: { key: string; value: Record<string, unknown> }[] }; scopeSpans: { spans: Record<string, unknown>[] }[] }[] }
}

function fakeHttp(status = 200) {
  const calls: Captured[] = []
  const http: OtlpHttp = {
    async post(url, headers, body) {
      calls.push({ url, headers, body: body as Captured['body'] })
      return { status }
    }
  }
  return { http, calls }
}

function adapter(http: OtlpHttp, over: Partial<OtlpConfig> = {}) {
  return new OtlpApmAdapter({ endpoint: 'https://otlp.vendor.example', http, ...over })
}

describe('P5 OTLP APM adapter — exportSpans', () => {
  it('accepts an OTel span batch (the contract: resolves undefined)', async () => {
    const { http } = fakeHttp()
    await expect(adapter(http).exportSpans([span])).resolves.toBeUndefined()
  })

  it('POSTs OTLP/HTTP JSON to /v1/traces with the configured headers', async () => {
    const { http, calls } = fakeHttp()
    await adapter(http, { headers: { authorization: 'Bearer k' }, serviceName: 'ofbo-bff' }).exportSpans([span])
    const c = calls[0]!
    expect(c.url).toBe('https://otlp.vendor.example/v1/traces')
    expect(c.headers).toMatchObject({ 'content-type': 'application/json', authorization: 'Bearer k' })
  })

  it('encodes the trace id from the UUID (32 hex) and derives an 8-byte span id', async () => {
    const { http, calls } = fakeHttp()
    await adapter(http).exportSpans([span])
    const s = calls[0]!.body.resourceSpans[0]!.scopeSpans[0]!.spans[0]! as Record<string, string>
    expect(s.traceId).toBe('4d2c2e2a000040008000000000000000') // the UUID, dashes stripped → 32 hex
    expect(s.spanId).toMatch(/^[0-9a-f]{16}$/) // opaque 'span-001' → deterministic 8-byte hex
  })

  it('encodes attribute value types (string/int/bool) and OK status', async () => {
    const { http, calls } = fakeHttp()
    await adapter(http).exportSpans([span])
    const s = calls[0]!.body.resourceSpans[0]!.scopeSpans[0]!.spans[0]! as Record<string, unknown>
    const attrs = s.attributes as { key: string; value: Record<string, unknown> }[]
    expect(attrs.find((a) => a.key === 'http.route')!.value).toEqual({ stringValue: '/test' })
    expect(attrs.find((a) => a.key === 'count')!.value).toEqual({ intValue: '3' })
    expect(attrs.find((a) => a.key === 'ok')!.value).toEqual({ boolValue: true })
    expect(s.status).toEqual({ code: 1 })
    // resource carries service.name
    const res = calls[0]!.body.resourceSpans[0]!.resource.attributes
    expect(res.find((a) => a.key === 'service.name')!.value).toEqual({ stringValue: 'ofbo-bff' })
  })

  it('maps an error span to OTLP status code 2', async () => {
    const { http, calls } = fakeHttp()
    await adapter(http).exportSpans([{ ...span, status_code: 'error' }])
    const s = calls[0]!.body.resourceSpans[0]!.scopeSpans[0]!.spans[0]! as Record<string, unknown>
    expect(s.status).toEqual({ code: 2 })
  })

  it('is a no-op for an empty batch (no POST)', async () => {
    const { http, calls } = fakeHttp()
    await adapter(http).exportSpans([])
    expect(calls).toHaveLength(0)
  })

  it('best-effort: a non-2xx or transport error never rejects (telemetry must not break the request)', async () => {
    const { http } = fakeHttp(500)
    await expect(adapter(http).exportSpans([span])).resolves.toBeUndefined()
    const throwing: OtlpHttp = { async post() { throw new Error('network down') } }
    await expect(adapter(throwing).exportSpans([span])).resolves.toBeUndefined()
  })
})

describe('P5 OTLP APM adapter — config', () => {
  it('throws a clear config error without an endpoint, and on bad headers JSON', () => {
    expect(() => otlpApmFromEnv({})).toThrow(OtlpConfigError)
    expect(() => otlpApmFromEnv({ P5_OTLP_ENDPOINT: 'https://x', P5_OTLP_HEADERS: 'not json' })).toThrow(/HEADERS/)
  })

  it('constructs from endpoint + optional headers/service name', () => {
    expect(
      otlpApmFromEnv({ P5_OTLP_ENDPOINT: 'https://otlp.vendor.example', P5_OTLP_HEADERS: JSON.stringify({ 'dd-api-key': 'k' }), P5_SERVICE_NAME: 'ofbo-bff' })
    ).toBeInstanceOf(OtlpApmAdapter)
  })
})
