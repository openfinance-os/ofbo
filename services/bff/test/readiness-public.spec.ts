import { describe, it, expect } from 'vitest'
import { createApp } from '../src/app.js'

// PUBLIC, pre-login: no authorization header, no x-fapi-interaction-id. The /public/* carve-out
// (ADR 0022) must serve these while every other route still demands auth.
const PUBLIC = { 'content-type': 'application/json' }

function app() {
  return createApp()
}

describe('public readiness — carve-out', () => {
  it('serves the catalog with no auth and no FAPI header', async () => {
    const res = await app().request('/public/readiness/catalog', { headers: PUBLIC })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { ports: unknown[]; decisions: unknown[] }; meta: { request_id: string } }
    expect(body.data.ports).toHaveLength(9)
    expect(body.data.decisions).toHaveLength(16)
    expect(body.meta.request_id).toBeTruthy()
  })

  it('the catalog does not leak internal scoring fields (contract: ReadinessCatalogPort)', async () => {
    const res = await app().request('/public/readiness/catalog', { headers: PUBLIC })
    const body = (await res.json()) as { data: { ports: Array<Record<string, unknown> & { options: Array<Record<string, unknown>> }> } }
    const port = body.data.ports[0]!
    expect(Object.keys(port).sort()).toEqual(['id', 'maps_to', 'name', 'options'])
    expect(port).not.toHaveProperty('contract_test_gate')
    expect(port).not.toHaveProperty('config_keys')
    expect(Object.keys(port.options[0]!).sort()).toEqual(['effort_band', 'label', 'value'])
    expect(port.options[0]).not.toHaveProperty('builtin')
  })

  it('a NON-public route still 400s without a FAPI header (carve-out is not a hole)', async () => {
    const res = await app().request('/approvals', { headers: { authorization: 'Bearer demo-token:compliance-officer' } })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('BACKOFFICE.MISSING_FAPI_INTERACTION_ID')
  })
})

describe('POST /public/readiness:assess', () => {
  it('scores a mapping into a digest', async () => {
    const res = await app().request('/public/readiness:assess', {
      method: 'POST',
      headers: PUBLIC,
      body: JSON.stringify({ ports: { P2: 'okta', P6: 'kong' }, decisions: { 'BD-12': 'group' } })
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { score: number; generated_profile: Record<string, string>; ports: unknown[] } }
    expect(body.data.score).toBeGreaterThan(0)
    expect(body.data.ports).toHaveLength(9)
    expect(body.data.generated_profile.BANK_ID_SCOPE).toBe('group')
  })

  it('400s on an unknown port option', async () => {
    const res = await app().request('/public/readiness:assess', {
      method: 'POST',
      headers: PUBLIC,
      body: JSON.stringify({ ports: { P2: 'nope' } })
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('BACKOFFICE.INVALID_READINESS_INPUT')
  })

  it('400s on a non-JSON body', async () => {
    const res = await app().request('/public/readiness:assess', { method: 'POST', headers: PUBLIC, body: 'not json' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BACKOFFICE.INVALID_BODY')
  })

  it('400s on an over-long decision answer (public free-text is length-capped)', async () => {
    const res = await app().request('/public/readiness:assess', {
      method: 'POST',
      headers: PUBLIC,
      body: JSON.stringify({ ports: { P2: 'okta' }, decisions: { 'BD-06': 'x'.repeat(201) } })
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BACKOFFICE.INVALID_READINESS_INPUT')
  })
})

describe('readiness profiles — save & reopen', () => {
  it('saves a named profile (201) and reopens it by slug (200)', async () => {
    const a = app()
    const save = await a.request('/public/readiness/profiles', {
      method: 'POST',
      headers: PUBLIC,
      body: JSON.stringify({ name: 'Bank A pilot', input: { ports: { P2: 'okta', P4: 't24' } } })
    })
    expect(save.status).toBe(201)
    const saved = (await save.json()) as { data: { slug: string; name: string; digest: { score: number } } }
    expect(saved.data.slug).toMatch(/^rdy-/)
    expect(saved.data.name).toBe('Bank A pilot')

    const get = await a.request(`/public/readiness/profiles/${saved.data.slug}`, { headers: PUBLIC })
    expect(get.status).toBe(200)
    const got = (await get.json()) as { data: { input: { ports: Record<string, string> }; digest: { score: number } } }
    expect(got.data.input.ports.P4).toBe('t24')
    expect(got.data.digest.score).toBe(saved.data.digest.score)
  })

  it('404s an unknown slug', async () => {
    const res = await app().request('/public/readiness/profiles/rdy-does-not-exist', { headers: PUBLIC })
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BACKOFFICE.READINESS_PROFILE_NOT_FOUND')
  })

  it('400s saving without a name', async () => {
    const res = await app().request('/public/readiness/profiles', {
      method: 'POST',
      headers: PUBLIC,
      body: JSON.stringify({ input: { ports: { P2: 'okta' } } })
    })
    expect(res.status).toBe(400)
  })

  it('400s saving an over-length name rather than silently truncating (spec maxLength 120)', async () => {
    const res = await app().request('/public/readiness/profiles', {
      method: 'POST',
      headers: PUBLIC,
      body: JSON.stringify({ name: 'N'.repeat(121), input: { ports: { P2: 'okta' } } })
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BACKOFFICE.INVALID_READINESS_INPUT')
  })
})
