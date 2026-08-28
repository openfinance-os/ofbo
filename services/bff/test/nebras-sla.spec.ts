import { describe, expect, it } from 'vitest'
import { NEBRAS_SLA_MS } from '../src/consents/nebras-sla.js'
import { NEBRAS_SLA_MS as fromRevoke } from '../src/consents/revoke.js'
import { NEBRAS_SLA_MS as fromBulkRevoke } from '../src/consents/bulk-revoke.js'
import { DemoSloReader } from '../src/analytics/slo.js'
// Build/test-time spec access, on the same subpath family as `@ofbo/contracts/testing` —
// deliberately NOT the runtime index, which Workers load and which must stay generated-artifacts
// only (packages/contracts/src/spec.ts).
import { loadSpec } from '@ofbo/contracts/spec'

/**
 * STD-09 — NFR-18's revoke SLA had three declarations and no single source.
 *
 * `consents/revoke.ts` and `consents/bulk-revoke.ts` each declared `NEBRAS_SLA_MS = 5000`, and
 * `analytics/slo.ts` restated the same threshold a third time in a DIFFERENT UNIT, as the prose
 * "< 5s" inside an SLO description string. Three copies of one regulatory threshold is three
 * chances to change two of them: a scheme amendment to 3s would leave whichever copy the editor
 * did not grep for still enforcing the old number, silently and in production.
 *
 * The unit difference is the part that makes it hard to catch — a grep for `5000` never finds the
 * SLO row, and the SLO row is the one an operator reads when asking what the target IS.
 */
describe('STD-09 — one definition of the Nebras revoke SLA', () => {
  it('is 5s, per NFR-18', () => {
    expect(NEBRAS_SLA_MS).toBe(5000)
  })

  it('is re-exported by every enforcing module, so a consumer cannot import a private copy', () => {
    expect(fromRevoke).toBe(NEBRAS_SLA_MS)
    expect(fromBulkRevoke).toBe(NEBRAS_SLA_MS)
  })

  /**
   * The assertion above does NOT prove single-sourcing, and an earlier version of this file
   * claimed it did — "identity, not equality". On a number primitive `toBe` IS value equality
   * (`Object.is(5000, 5000)` is true), so re-introducing `export const NEBRAS_SLA_MS = 5000` in
   * revoke.ts would pass it. The comment described a guard that did not exist.
   *
   * A duplicate literal is a property of the SOURCE, not of the runtime values, so this reads the
   * source. `nebras-sla.ts` is the one file allowed to write the number down; anywhere else, a
   * scheme amendment would have to find it by grep — which is exactly how the three-way drift this
   * story fixed came about.
   */
  it('is written down in exactly one file', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const dir = new URL('../src/consents/', import.meta.url)
    const offenders: string[] = []
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts') || file === 'nebras-sla.ts') continue
      const src = readFileSync(new URL(file, dir), 'utf8')
      // A declaration of the value, not a mention of it: `= 5000`, `= 5_000`, `: 5000`.
      for (const line of src.split('\n')) {
        if (/[=:]\s*5_?000\b/.test(line)) offenders.push(`${file}: ${line.trim()}`)
      }
    }
    expect(offenders, 'the NFR-18 threshold is declared outside nebras-sla.ts').toEqual([])
  })

  /**
   * BACKOFFICE-91 — the fourth copy, in the artifact with the widest audience.
   *
   * STD-09's premise was "declared three times, now once". It enumerated the copies in CODE and
   * missed the one in the ground-truth document: `nebras_propagation_ms` described the bound as
   * prose ("Must be < 5000 p99"), derived from nothing and compared by nothing. A scheme amendment
   * would have left the PUBLISHED CONTRACT telling integrators 5000 while the services enforced
   * something else — and an integrator reading the contract has no way to discover the
   * disagreement, which makes it the worst of the four places for the number to be wrong.
   *
   * The bound stays IN the contract, because a contract that says "see NFR-18" is worse for the
   * integrator than one that states the number. What was missing is the link, so the number is now
   * machine-readable (`x-nfr18-p99-max-ms`, the same vendor-extension mechanism the spec already
   * uses for `x-required-scope` and `x-four-eyes`) and this test is the link.
   */
  it('agrees with the contract, which states the same bound machine-readably', () => {
    const spec = loadSpec()
    const field =
      spec.components.responses.RevocationResult.content['application/json'].schema.allOf[1].properties.data
        .properties.nebras_propagation_ms
    expect(field['x-nfr18-p99-max-ms']).toBe(NEBRAS_SLA_MS)
    // The human-readable half must carry the same number as the machine-readable half — a
    // description that drifts from its own extension is the original defect in miniature.
    expect(field.description).toContain(String(NEBRAS_SLA_MS))
  })

  /**
   * `maximum: 5000` would be the obvious-looking tightening and it would be wrong. This field
   * records what actually HAPPENED, and STD-09 added a fraud-revoke test that drives a 6.1s
   * acknowledgment specifically to prove a BREACH is visible in the audit record. A schema
   * constraint would make the breach unrepresentable, and therefore invisible to exactly the review
   * most likely to ask about it.
   */
  it('does not constrain the field, so a breach stays representable', () => {
    const spec = loadSpec()
    const field =
      spec.components.responses.RevocationResult.content['application/json'].schema.allOf[1].properties.data
        .properties.nebras_propagation_ms
    expect(field.maximum).toBeUndefined()
    expect(field.exclusiveMaximum).toBeUndefined()
  })

  it('derives the SLO description from the constant rather than restating it', async () => {
    const [row] = await new DemoSloReader().getSloObservations()
    // The key names the SLO and carries no threshold — it used to be `nebras_propagation_5s`,
    // which put a stale number in the field consumers match on.
    expect(row!.key).toBe('nebras_propagation_sla')
    expect(row!.key).not.toMatch(/\d/)
    // The description must carry the threshold the code enforces. Change NEBRAS_SLA_MS and this
    // row moves with it; before, it was prose that could disagree with the enforcement silently.
    expect(row!.description).toContain(`${NEBRAS_SLA_MS / 1000}s`)
  })
})
