import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Anti-drift guard: the harness map the portal SERVES (apps/portal/public/harness-map.html,
 * embedded by the "How this was built" colophon) must stay byte-identical to the canonical
 * repo artifact (docs/harness-map.html). One source of truth, two homes — a repo reader opens
 * the doc, the running portal serves the public copy. If they drift, the colophon would show a
 * stale map; this fails CI before that can ship (same spirit as the Q2b doc-integrity gate).
 */
const docs = fileURLToPath(new URL('../../../docs/harness-map.html', import.meta.url))
const served = fileURLToPath(new URL('../public/harness-map.html', import.meta.url))

describe('harness map — served copy matches the canonical doc', () => {
  it('apps/portal/public/harness-map.html is byte-identical to docs/harness-map.html', () => {
    const a = readFileSync(docs, 'utf8')
    const b = readFileSync(served, 'utf8')
    expect(b, 'served harness map drifted from docs/harness-map.html — re-copy the canonical file').toEqual(a)
  })
})
