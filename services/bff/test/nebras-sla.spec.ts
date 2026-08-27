import { describe, expect, it } from 'vitest'
import { NEBRAS_SLA_MS } from '../src/consents/nebras-sla.js'
import { NEBRAS_SLA_MS as fromRevoke } from '../src/consents/revoke.js'
import { NEBRAS_SLA_MS as fromBulkRevoke } from '../src/consents/bulk-revoke.js'
import { DemoSloReader } from '../src/analytics/slo.js'

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
