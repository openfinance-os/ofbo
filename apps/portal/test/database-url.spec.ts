import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The portal's direct store reads (sign-in audit write, dashboard audit panel) connected to Postgres
 * over DATABASE_URL — a fresh TCP + TLS handshake from the edge to the database region on every
 * render. The BFF already routes through the Hyperdrive binding for exactly this reason; the portal
 * now does the same when the binding is present, and falls back to DATABASE_URL (local dev, tests).
 */
const ctx = vi.hoisted(() => ({ env: undefined as Record<string, unknown> | undefined }))
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => {
    if (!ctx.env) throw new Error('not in a Cloudflare request context')
    return { env: ctx.env }
  }
}))

import { databaseUrl } from '../src/lib/database-url.js'

afterEach(() => {
  ctx.env = undefined
  vi.unstubAllEnvs()
})

describe('databaseUrl', () => {
  it('prefers the Hyperdrive binding inside a Worker request', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://direct.example.invalid/ofbo')
    ctx.env = { HYPERDRIVE: { connectionString: 'postgresql://hyperdrive.example.invalid/ofbo' } }
    expect(databaseUrl()).toBe('postgresql://hyperdrive.example.invalid/ofbo')
  })

  it('falls back to DATABASE_URL when the binding is absent', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://direct.example.invalid/ofbo')
    ctx.env = {}
    expect(databaseUrl()).toBe('postgresql://direct.example.invalid/ofbo')
  })

  it('falls back to DATABASE_URL outside a Worker request', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://direct.example.invalid/ofbo')
    expect(databaseUrl()).toBe('postgresql://direct.example.invalid/ofbo')
  })

  it('is undefined when neither is configured', () => {
    vi.stubEnv('DATABASE_URL', '')
    expect(databaseUrl()).toBeUndefined()
  })
})
