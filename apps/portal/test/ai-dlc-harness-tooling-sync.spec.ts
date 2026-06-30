import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Anti-drift guard: the AI-DLC tooling page the portal SERVES
 * (apps/portal/public/ai-dlc-harness-tooling.html, linked from the "How this was built"
 * colophon) must stay byte-identical to the canonical repo artifact
 * (docs/research/ai-dlc-harness-tooling.html). One source of truth, two homes — a repo
 * reader opens the doc, the running portal serves the public copy. If they drift, the
 * colophon would link a stale page; this fails CI before that can ship (same spirit as the
 * the-loom-ways-of-working sync guard and the Q2b doc-integrity gate).
 */
const docs = fileURLToPath(
  new URL('../../../docs/research/ai-dlc-harness-tooling.html', import.meta.url),
)
const served = fileURLToPath(new URL('../public/ai-dlc-harness-tooling.html', import.meta.url))

describe('AI-DLC tooling page — served copy matches the canonical doc', () => {
  it('apps/portal/public/ai-dlc-harness-tooling.html is byte-identical to docs/research/ai-dlc-harness-tooling.html', () => {
    const a = readFileSync(docs, 'utf8')
    const b = readFileSync(served, 'utf8')
    expect(
      b,
      'served AI-DLC tooling page drifted from docs/research/ai-dlc-harness-tooling.html — re-copy the canonical file',
    ).toEqual(a)
  })
})
