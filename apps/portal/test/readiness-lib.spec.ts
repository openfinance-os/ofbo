import { describe, expect, it, vi } from 'vitest'
import {
  getReadinessCatalog,
  assessReadiness,
  saveReadinessProfile,
  getReadinessProfile,
  ReadinessApiError
} from '../src/lib/readiness.js'

const BASE = 'http://bff.test'
const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data, meta: {} }), { status, headers: { 'content-type': 'application/json' } })

describe('readiness lib — public BFF calls (no auth)', () => {
  it('GETs the catalog with a trace id and NO authorization header', async () => {
    const fetchImpl = vi.fn(async () => ok({ ports: [], decisions: [] }))
    await getReadinessCatalog({ baseUrl: BASE, fetchImpl, traceId: 'trace-1' })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(`${BASE}/public/readiness/catalog`)
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers['x-fapi-interaction-id']).toBe('trace-1')
    expect(headers.authorization).toBeUndefined()
  })

  it('POSTs an assessment input to :assess with no auth', async () => {
    const fetchImpl = vi.fn(async () => ok({ score: 70 }))
    await assessReadiness({ ports: { P2: 'okta' } }, { baseUrl: BASE, fetchImpl })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(`${BASE}/public/readiness:assess`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ ports: { P2: 'okta' } })
    expect((init?.headers as Record<string, string>).authorization).toBeUndefined()
  })

  it('POSTs a named profile and GETs it back by slug', async () => {
    const save = vi.fn(async () => ok({ slug: 'rdy-1', name: 'Bank A' }, 201))
    await saveReadinessProfile('Bank A', { ports: { P2: 'okta' } }, { baseUrl: BASE, fetchImpl: save })
    expect(JSON.parse(String(save.mock.calls[0]![1]?.body))).toEqual({ name: 'Bank A', input: { ports: { P2: 'okta' } } })

    const get = vi.fn(async () => ok({ slug: 'rdy-1' }))
    await getReadinessProfile('rdy-1', { baseUrl: BASE, fetchImpl: get })
    expect(get.mock.calls[0]![0]).toBe(`${BASE}/public/readiness/profiles/rdy-1`)
  })

  it('throws ReadinessApiError carrying the BFF error code on a non-2xx', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: 'BACKOFFICE.INVALID_READINESS_INPUT', message: 'bad' } }), { status: 400 })
    )
    await expect(assessReadiness({ ports: {} }, { baseUrl: BASE, fetchImpl })).rejects.toMatchObject({
      code: 'BACKOFFICE.INVALID_READINESS_INPUT',
      status: 400
    })
    await expect(assessReadiness({ ports: {} }, { baseUrl: BASE, fetchImpl })).rejects.toBeInstanceOf(ReadinessApiError)
  })
})
