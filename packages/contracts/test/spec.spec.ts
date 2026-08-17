import { describe, expect, it } from 'vitest'
import { loadSpec, listRoutes } from '../src/spec.js'

// ADR 0022 — the public, pre-login readiness routes are the ONE unauthenticated route class:
// no admin scope, no x-fapi-interaction-id, no Idempotency-Key (a prospect's browser sends none).
// The admin-contract canon below deliberately excludes them; they have their own carve-out checks.
const isPublic = (path: string) => path.startsWith('/public/')

describe('contract canon', () => {
  it('has exactly 95 paths and 12 tags (incl. the 5 public readiness paths + readiness tag)', () => {
    const spec = loadSpec()
    expect(Object.keys(spec.paths)).toHaveLength(95)
    expect(spec.tags).toHaveLength(12)
  })

  it('every admin route requires x-fapi-interaction-id (public routes exempt — ADR 0022)', () => {
    for (const r of listRoutes().filter((r) => !isPublic(r.path))) {
      expect(r.parameters, `${r.method} ${r.path}`).toContain('x-fapi-interaction-id')
    }
  })

  it('the public carve-out is exactly /public/readiness/* and carries no admin scope', () => {
    const publicRoutes = listRoutes().filter((r) => isPublic(r.path))
    expect(publicRoutes.length).toBe(5)
    for (const r of publicRoutes) {
      expect(r.path.startsWith('/public/readiness'), r.path).toBe(true)
      expect(r.scope, `${r.method} ${r.path}`).toBeNull()
      expect(r.parameters, `${r.method} ${r.path}`).not.toContain('x-fapi-interaction-id')
    }
  })

  it('every state-changing admin route requires Idempotency-Key (public and explicitly pure routes exempt)', () => {
    const mutating = listRoutes().filter(
      (r) => ['post', 'put', 'patch', 'delete'].includes(r.method) && !isPublic(r.path) && !r.pure
    )
    expect(mutating.length).toBeGreaterThan(0)
    for (const r of mutating) {
      expect(r.parameters, `${r.method} ${r.path}`).toContain('Idempotency-Key')
    }
  })

  it('marks only the non-persisting billing simulation as a pure POST', () => {
    const pureRoutes = listRoutes().filter((route) => route.pure)
    expect(pureRoutes).toEqual([
      expect.objectContaining({ method: 'post', path: '/back-office/billing/profitability:simulate' })
    ])
  })

  it('four-eyes routes are flagged', () => {
    const fourEyes = listRoutes().filter((r) => r.fourEyes)
    const paths = fourEyes.map((r) => r.path)
    expect(paths).toContain('/consents:revoke-bulk')
    expect(paths).toContain('/disputes/{dispute_id}:initiate-refund')
  })

  it('every route carries a tag from the canonical 9', () => {
    const spec = loadSpec()
    const tagNames = new Set((spec.tags as { name: string }[]).map((t) => t.name))
    for (const r of listRoutes()) {
      expect(tagNames.has(r.tag), `${r.method} ${r.path} tag=${r.tag}`).toBe(true)
    }
  })
})
