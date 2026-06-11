import { describe, expect, it } from 'vitest'
import { ROUTES } from '@ofbo/contracts'
import { createApp, IMPLEMENTED_ROUTES } from '../src/app.js'
import { toConcrete, AUTHED_HEADERS } from './helpers.js'

const app = createApp()

/**
 * Red-by-design (M0 exit criterion: stubs exist and demonstrably fail, CI green).
 * `it.fails` passes while the route is unimplemented (501) and BREAKS the moment a
 * story implements it — forcing that story to replace the entry with real contract tests.
 */
describe('[contract-pending] every path awaits its story', () => {
  it.fails.each(ROUTES.filter((r) => !IMPLEMENTED_ROUTES.has(`${r.method} ${r.path}`)).map((r) => [`${r.method.toUpperCase()} ${r.path}`, r] as const))(
    '%s is implemented',
    async (_name, route) => {
      const res = await app.request(toConcrete(route.path), {
        method: route.method.toUpperCase(),
        headers: AUTHED_HEADERS
      })
      expect(res.status).not.toBe(501)
    }
  )
})
