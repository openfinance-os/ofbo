import { describe, expect, it } from 'vitest'
import { ROUTES } from '@ofbo/contracts'
import { createApp } from '../src/app.js'
import { toConcrete, FAPI_HEADERS } from './helpers.js'

const app = createApp()

describe('binding envelopes on every stubbed route', () => {
  it.each(ROUTES.map((r) => [r.method, r.path] as const))(
    '%s %s → 501 with binding error envelope',
    async (method, path) => {
      const res = await app.request(toConcrete(path), {
        method: method.toUpperCase(),
        headers: FAPI_HEADERS
      })
      expect(res.status).toBe(501)
      const body = (await res.json()) as {
        error: Record<string, string>
        meta: Record<string, string>
      }
      expect(body.error.code).toBe('BACKOFFICE.NOT_IMPLEMENTED')
      for (const k of ['code', 'message', 'remediation', 'docs_url']) {
        expect(body.error[k], `error.${k}`).toBeTruthy()
      }
      expect(body.meta.request_id).toBeTruthy()
      expect(body.meta.timestamp).toBeTruthy()
    }
  )

  it('unknown path → 404 binding envelope', async () => {
    const res = await app.request('/nope', { headers: FAPI_HEADERS })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: Record<string, string> }
    expect(body.error.code).toBe('BACKOFFICE.ROUTE_NOT_FOUND')
    expect(body.error.remediation).toBeTruthy()
  })

  it('missing x-fapi-interaction-id → 400 binding envelope', async () => {
    const res = await app.request('/back-office/reconciliation/runs')
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: Record<string, string> }
    expect(body.error.code).toBe('BACKOFFICE.MISSING_FAPI_INTERACTION_ID')
  })

  it('echoes x-fapi-interaction-id back on the response', async () => {
    const res = await app.request('/back-office/reconciliation/runs', { headers: FAPI_HEADERS })
    expect(res.headers.get('x-fapi-interaction-id')).toBe(FAPI_HEADERS['x-fapi-interaction-id'])
  })
})
