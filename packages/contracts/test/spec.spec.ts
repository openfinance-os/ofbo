import { describe, expect, it } from 'vitest'
import { loadSpec, listRoutes } from '../src/spec.js'

describe('contract canon', () => {
  it('has exactly 80 paths and 11 tags', () => {
    const spec = loadSpec()
    expect(Object.keys(spec.paths)).toHaveLength(80)
    expect(spec.tags).toHaveLength(11)
  })

  it('every route requires x-fapi-interaction-id', () => {
    for (const r of listRoutes()) {
      expect(r.parameters, `${r.method} ${r.path}`).toContain('x-fapi-interaction-id')
    }
  })

  it('every mutating route requires Idempotency-Key', () => {
    const mutating = listRoutes().filter((r) => ['post', 'put', 'patch', 'delete'].includes(r.method))
    expect(mutating.length).toBeGreaterThan(0)
    for (const r of mutating) {
      expect(r.parameters, `${r.method} ${r.path}`).toContain('Idempotency-Key')
    }
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
