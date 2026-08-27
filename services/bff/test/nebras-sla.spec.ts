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

  it('is the SAME object everywhere it is enforced, not a copy that agrees today', () => {
    // Identity, not equality: two independent `= 5000` literals also pass an equality check, and
    // that is exactly the state this story found.
    expect(fromRevoke).toBe(NEBRAS_SLA_MS)
    expect(fromBulkRevoke).toBe(NEBRAS_SLA_MS)
  })

  it('derives the SLO description from the constant rather than restating it', async () => {
    const [row] = await new DemoSloReader().getSloObservations()
    expect(row!.key).toBe('nebras_propagation_5s')
    // The description must carry the threshold the code enforces. Change NEBRAS_SLA_MS and this
    // row moves with it; before, it was prose that could disagree with the enforcement silently.
    expect(row!.description).toContain(`${NEBRAS_SLA_MS / 1000}s`)
  })
})
