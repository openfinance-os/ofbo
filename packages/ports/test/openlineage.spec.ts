import { describe, expect, it, vi } from 'vitest'
import { createOpenLineageAdapter, openLineageFromEnv, OpenLineageError } from '../src/adapters/enterprise/openlineage.js'

const event = { table: 'reconciliation_break', columns: ['variance_amount', 'currency'], source: 'recon-engine', trace_id: '4d2c2e2a-0000-4000-8000-000000000000' }

function fakeTransport(status = 201) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(null, { status })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

describe('OpenLineage P7 adapter — event → RunEvent mapping (faked catalogue)', () => {
  it('POSTs a COMPLETE RunEvent to <endpoint>/api/v1/lineage with merged headers', async () => {
    const { calls, fetchImpl } = fakeTransport()
    const adapter = createOpenLineageAdapter({
      endpoint: 'https://marquez.bank.example',
      namespace: 'ofbo',
      headers: { 'x-api-key': 'static' },
      getHeaders: async () => ({ authorization: 'Bearer dyn' }),
      fetchImpl
    })

    await adapter.emitLineage(event)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://marquez.bank.example/api/v1/lineage')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('static')
    expect(headers.authorization).toBe('Bearer dyn')
    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.eventType).toBe('COMPLETE')
    expect(typeof body.eventTime).toBe('string')
    expect(body.producer).toContain('openfinance-os/ofbo')
  })

  it('maps source → job.name, table → output dataset, and columns → schema-facet fields', async () => {
    const { calls, fetchImpl } = fakeTransport()
    await createOpenLineageAdapter({ endpoint: 'https://x', datasetNamespace: 'ofbo-pg', fetchImpl }).emitLineage(event)
    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.job).toMatchObject({ namespace: 'ofbo', name: 'recon-engine' })
    expect(body.outputs[0]).toMatchObject({ namespace: 'ofbo-pg', name: 'reconciliation_break' })
    expect(body.outputs[0].facets.schema.fields).toEqual([{ name: 'variance_amount' }, { name: 'currency' }])
    expect(body.outputs[0].facets.schema._schemaURL).toContain('openlineage.io')
  })

  it('uses the x-fapi-interaction-id as the run UUID and carries it on a run facet (BCBS 239 traceability)', async () => {
    const { calls, fetchImpl } = fakeTransport()
    await createOpenLineageAdapter({ endpoint: 'https://x', fetchImpl }).emitLineage(event)
    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.run.runId).toBe('4d2c2e2a-0000-4000-8000-000000000000')
    expect(body.run.facets.ofbo_trace.fapi_interaction_id).toBe(event.trace_id)
  })

  it('shapes a non-UUID trace id into UUID form so the run is never rejected', async () => {
    const { calls, fetchImpl } = fakeTransport()
    await createOpenLineageAdapter({ endpoint: 'https://x', fetchImpl }).emitLineage({ ...event, trace_id: 'not-a-uuid' })
    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.run.runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(body.run.facets.ofbo_trace.fapi_interaction_id).toBe('not-a-uuid') // original preserved on the facet
  })

  it('throws a retryable error on 5xx, non-retryable on 4xx', async () => {
    await expect(createOpenLineageAdapter({ endpoint: 'https://x', fetchImpl: fakeTransport(503).fetchImpl }).emitLineage(event)).rejects.toMatchObject({ name: 'OpenLineageError', retryable: true, status: 503 })
    await expect(createOpenLineageAdapter({ endpoint: 'https://x', fetchImpl: fakeTransport(422).fetchImpl }).emitLineage(event)).rejects.toMatchObject({ retryable: false, status: 422 })
  })
})

describe('OpenLineage P7 adapter — fail-closed + env wiring', () => {
  it('createOpenLineageAdapter() throws without an endpoint (no silent fake)', () => {
    expect(() => createOpenLineageAdapter()).toThrow(OpenLineageError)
  })

  it('openLineageFromEnv targets OPENLINEAGE_URL and bearers OPENLINEAGE_API_KEY', async () => {
    const { calls, fetchImpl } = fakeTransport()
    vi.stubGlobal('fetch', fetchImpl)
    try {
      const fromEnv = openLineageFromEnv({ OPENLINEAGE_URL: 'https://catalogue.bank.example', OPENLINEAGE_NAMESPACE: 'ofbo-prod', OPENLINEAGE_API_KEY: 'k-123' })
      await fromEnv.emitLineage(event)
      expect(calls[0]!.url).toBe('https://catalogue.bank.example/api/v1/lineage')
      expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer k-123')
      expect(JSON.parse(String(calls[0]!.init.body)).job.namespace).toBe('ofbo-prod')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('openLineageFromEnv throws when no OPENLINEAGE_URL is set', () => {
    expect(() => openLineageFromEnv({})).toThrow(/misconfigured/)
  })
})
