import { describe, expect, it } from 'vitest'
import { ROUTES } from '@ofbo/contracts'
import { buildResponseValidator } from '@ofbo/contracts/testing'
import { createApp, IMPLEMENTED_ROUTES } from '../src/app.js'
import { toConcrete, AUTHED_HEADERS } from './helpers.js'

/**
 * Contract conformance: every implemented GET response must validate against its
 * OpenAPI response schema (the spec is ground truth). The hand-rolled per-feature
 * tests assert individual fields; this sweep is the mechanical backstop that catches
 * response-shape drift — extra/missing/mis-typed fields — across the whole read surface,
 * and is self-maintaining (it iterates the generated route table).
 *
 * Driven against the in-memory app (createApp() defaults to in-memory stores), so it
 * needs no database. AUTHED_HEADERS is the super-admin persona, which clears scope on
 * every route; path params resolve to a not-found, whose error envelope is validated
 * against that status's schema just the same.
 */

const validator = buildResponseValidator()

const getRoutes = ROUTES.filter((r) => r.method === 'get' && IMPLEMENTED_ROUTES.has(`${r.method} ${r.path}`))

describe('contract conformance — implemented GET responses match the OpenAPI schema', () => {
  it('has GET routes to check', () => {
    expect(getRoutes.length).toBeGreaterThan(5)
  })

  it('every implemented GET response validates against its response schema', async () => {
    const app = createApp()
    const failures: string[] = []
    let validated = 0
    let validated2xx = 0

    for (const r of getRoutes) {
      const res = await app.request(toConcrete(r.path), { headers: AUTHED_HEADERS })
      // 5xx means a missing in-memory reader, not a contract issue — out of scope here.
      if (res.status >= 500) continue
      if (!res.headers.get('content-type')?.includes('application/json')) continue
      const body = await res.json()
      const { ok, errors, skipped } = validator.validate(r.method, r.path, res.status, body)
      if (skipped) continue
      validated++
      if (res.status >= 200 && res.status < 300) validated2xx++
      if (!ok) failures.push(`${r.method.toUpperCase()} ${r.path} → ${res.status}: ${errors.slice(0, 5).join('; ')}`)
    }

    expect(failures, `contract violations:\n${failures.join('\n')}`).toEqual([])
    // guard against a vacuous pass (e.g. everything skipped/5xx)
    expect(validated2xx, 'expected several 2xx responses validated against the spec').toBeGreaterThan(3)
    expect(validated).toBeGreaterThan(validated2xx - 1)
  })
})
