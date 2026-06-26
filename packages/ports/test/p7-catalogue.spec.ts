import { describe, expect, it } from 'vitest'
import {
  CatalogueLineageAdapter,
  catalogueLineageFromEnv,
  CatalogueConfigError,
  type CatalogueHttp,
  type CatalogueConfig
} from '../src/adapters/enterprise/p7-catalogue.js'

function fakeHttp(status = 200) {
  const calls: { path: string; body: Record<string, unknown> }[] = []
  const http: CatalogueHttp = {
    async post(path, body) {
      calls.push({ path, body })
      return { status }
    }
  }
  return { http, calls }
}

const adapter = (http: CatalogueHttp, over: Partial<CatalogueConfig> = {}) =>
  new CatalogueLineageAdapter({ vendor: 'generic', http, ...over })

const EVENT = { table: 'reconciliation_break', columns: ['variance_amount'], source: 'recon-engine', trace_id: '4d2c2e2a-0000-4000-8000-000000000000' }

describe('P7 data-catalogue adapter — emitLineage (the contract)', () => {
  it('accepts a column-level lineage emission (resolves undefined)', async () => {
    const { http } = fakeHttp()
    await expect(adapter(http).emitLineage(EVENT)).resolves.toBeUndefined()
  })

  it('posts a normalized column-level lineage record (source → table, columns, trace)', async () => {
    const { http, calls } = fakeHttp()
    await adapter(http).emitLineage(EVENT)
    expect(calls[0]!.path).toBe('/lineage') // generic vendor
    expect(calls[0]!.body).toEqual({
      target_table: 'reconciliation_break',
      columns: ['variance_amount'],
      source: 'recon-engine',
      trace_id: EVENT.trace_id
    })
  })

  it('routes to the vendor lineage endpoint (Purview/Atlas, Collibra)', async () => {
    const purview = fakeHttp()
    await adapter(purview.http, { vendor: 'purview' }).emitLineage(EVENT)
    expect(purview.calls[0]!.path).toBe('/catalog/api/atlas/v2/lineage')

    const collibra = fakeHttp()
    await adapter(collibra.http, { vendor: 'collibra' }).emitLineage(EVENT)
    expect(collibra.calls[0]!.path).toBe('/rest/2.0/lineage')
  })

  it('throws on a non-2xx so the caller (write-path store) can surface the lineage gap', async () => {
    await expect(adapter(fakeHttp(503).http).emitLineage(EVENT)).rejects.toThrow(/HTTP 503/)
  })
})

describe('P7 data-catalogue adapter — config', () => {
  it('throws a clear config error on missing url/auth or a bad vendor', () => {
    expect(() => catalogueLineageFromEnv({})).toThrow(CatalogueConfigError)
    expect(() => catalogueLineageFromEnv({ P7_CATALOGUE_BASE_URL: 'https://x' })).toThrow(/AUTH/)
    expect(() => catalogueLineageFromEnv({ P7_CATALOGUE_BASE_URL: 'https://x', P7_CATALOGUE_AUTH: 'Bearer t', P7_CATALOGUE_VENDOR: 'sap' })).toThrow(/purview.*collibra.*generic/)
  })
  it('constructs from a complete config', () => {
    expect(catalogueLineageFromEnv({ P7_CATALOGUE_BASE_URL: 'https://purview.example', P7_CATALOGUE_AUTH: 'Bearer t', P7_CATALOGUE_VENDOR: 'purview' })).toBeInstanceOf(CatalogueLineageAdapter)
  })
})
