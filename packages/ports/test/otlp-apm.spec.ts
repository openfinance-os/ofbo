import { describe, expect, it, vi } from 'vitest'
import type { OtelSpan } from '../src/interfaces.js'
import { createOtlpApmAdapter, otlpApmFromEnv } from '../src/adapters/enterprise/otlp-apm.js'

const span: OtelSpan = {
  name: 'GET /back-office/consents/search',
  trace_id: '4d2c2e2a-0000-4000-8000-000000000000', // x-fapi-interaction-id (UUID)
  span_id: 'span-001',
  parent_span_id: 'root',
  start_time: 1_000, // epoch-ms
  end_time: 1_005,
  status_code: 'ok',
  attributes: { 'http.route': '/consents/search', 'http.status_code': 200, 'cache.hit': true, 'sample.rate': 0.25 }
}

function fakeTransport(status = 200) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify({ partialSuccess: {} }), { status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

describe('OTLP P5 APM adapter — span → OTLP/HTTP mapping (faked collector)', () => {
  it('POSTs well-formed resourceSpans to the configured endpoint with merged headers', async () => {
    const { calls, fetchImpl } = fakeTransport()
    const adapter = createOtlpApmAdapter({
      endpoint: 'https://otlp.bank.example/v1/traces',
      serviceName: 'ofbo-bff',
      headers: { 'x-api-key': 'static' },
      getHeaders: async () => ({ authorization: 'Bearer dyn' }),
      fetchImpl
    })

    await adapter.exportSpans([span])

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://otlp.bank.example/v1/traces')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('static')
    expect(headers.authorization).toBe('Bearer dyn') // dynamic merged over static
    const body = JSON.parse(String(calls[0]!.init.body))
    const otlpSpan = body.resourceSpans[0].scopeSpans[0].spans[0]
    expect(body.resourceSpans[0].resource.attributes[0]).toEqual({ key: 'service.name', value: { stringValue: 'ofbo-bff' } })
    expect(otlpSpan.name).toBe(span.name)
    expect(otlpSpan.status).toEqual({ code: 1 }) // ok → STATUS_CODE_OK
  })

  it('normalizes ids to OTLP hex: UUID trace → 32 hex, derived span/parent → 16 hex', async () => {
    const { calls, fetchImpl } = fakeTransport()
    const adapter = createOtlpApmAdapter({ endpoint: 'https://x/v1/traces', fetchImpl })
    await adapter.exportSpans([span])
    const s = JSON.parse(String(calls[0]!.init.body)).resourceSpans[0].scopeSpans[0].spans[0]
    expect(s.traceId).toBe('4d2c2e2a000040008000000000000000') // UUID with dashes stripped
    expect(s.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(s.spanId).toMatch(/^[0-9a-f]{16}$/)
    expect(s.parentSpanId).toMatch(/^[0-9a-f]{16}$/)
  })

  it('derives ids deterministically (same input → same hex)', async () => {
    const a = fakeTransport()
    const b = fakeTransport()
    await createOtlpApmAdapter({ endpoint: 'https://x/v1/traces', fetchImpl: a.fetchImpl }).exportSpans([span])
    await createOtlpApmAdapter({ endpoint: 'https://x/v1/traces', fetchImpl: b.fetchImpl }).exportSpans([span])
    const sa = JSON.parse(String(a.calls[0]!.init.body)).resourceSpans[0].scopeSpans[0].spans[0]
    const sb = JSON.parse(String(b.calls[0]!.init.body)).resourceSpans[0].scopeSpans[0].spans[0]
    expect(sa.spanId).toBe(sb.spanId)
  })

  it('maps unix-nano times and typed attributes (string/int/double/bool)', async () => {
    const { calls, fetchImpl } = fakeTransport()
    await createOtlpApmAdapter({ endpoint: 'https://x/v1/traces', fetchImpl }).exportSpans([span])
    const s = JSON.parse(String(calls[0]!.init.body)).resourceSpans[0].scopeSpans[0].spans[0]
    expect(s.startTimeUnixNano).toBe('1000000000') // 1000 ms → ns
    expect(s.endTimeUnixNano).toBe('1005000000')
    const attrs = Object.fromEntries((s.attributes as { key: string; value: Record<string, unknown> }[]).map((a) => [a.key, a.value]))
    expect(attrs['http.route']).toEqual({ stringValue: '/consents/search' })
    expect(attrs['http.status_code']).toEqual({ intValue: '200' })
    expect(attrs['cache.hit']).toEqual({ boolValue: true })
    expect(attrs['sample.rate']).toEqual({ doubleValue: 0.25 })
  })

  it('maps error status to STATUS_CODE_ERROR (2)', async () => {
    const { calls, fetchImpl } = fakeTransport()
    await createOtlpApmAdapter({ endpoint: 'https://x/v1/traces', fetchImpl }).exportSpans([{ ...span, status_code: 'error' }])
    const s = JSON.parse(String(calls[0]!.init.body)).resourceSpans[0].scopeSpans[0].spans[0]
    expect(s.status).toEqual({ code: 2 })
  })

  it('skips the POST entirely for an empty batch', async () => {
    const { calls, fetchImpl } = fakeTransport()
    await createOtlpApmAdapter({ endpoint: 'https://x/v1/traces', fetchImpl }).exportSpans([])
    expect(calls).toHaveLength(0)
  })

  it('throws a retryable error on 5xx, non-retryable on 4xx', async () => {
    await expect(createOtlpApmAdapter({ endpoint: 'https://x/v1/traces', fetchImpl: fakeTransport(503).fetchImpl }).exportSpans([span])).rejects.toMatchObject({ name: 'OtlpApmError', retryable: true, status: 503 })
    await expect(createOtlpApmAdapter({ endpoint: 'https://x/v1/traces', fetchImpl: fakeTransport(401).fetchImpl }).exportSpans([span])).rejects.toMatchObject({ retryable: false, status: 401 })
  })
})

describe('OTLP P5 APM adapter — fail-closed + env wiring', () => {
  it('exportSpans on an empty batch is a no-op even without an endpoint', async () => {
    await expect(createOtlpApmAdapter().exportSpans([])).resolves.toBeUndefined()
  })

  it('exportSpans throws (no silent fake) when no endpoint is configured', async () => {
    await expect(createOtlpApmAdapter().exportSpans([span])).rejects.toMatchObject({ name: 'OtlpApmError' })
  })

  it('otlpApmFromEnv derives /v1/traces from OTEL_EXPORTER_OTLP_ENDPOINT and parses OTEL_EXPORTER_OTLP_HEADERS', async () => {
    // endpoint set → the env-built adapter uses the REAL path (global fetch); stub it so we
    // can assert the derived URL + parsed headers without a network call.
    const { calls, fetchImpl } = fakeTransport()
    vi.stubGlobal('fetch', fetchImpl)
    try {
      const fromEnv = otlpApmFromEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.bank.example/', OTEL_EXPORTER_OTLP_HEADERS: 'x-key=abc, authorization=Bearer z' })
      await fromEnv.exportSpans([span])
      expect(calls[0]!.url).toBe('https://collector.bank.example/v1/traces') // trailing slash trimmed, /v1/traces appended
      expect(calls[0]!.init.headers).toMatchObject({ 'x-key': 'abc', authorization: 'Bearer z' }) // comma-split, trimmed
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('otlpApmFromEnv throws when no OTEL endpoint is set', () => {
    expect(() => otlpApmFromEnv({})).toThrow(/misconfigured/)
  })
})
