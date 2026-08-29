import { describe, expect, it } from 'vitest'
import { NEBRAS_SLA_MS } from '../src/consents/nebras-sla.js'
import { NEBRAS_SLA_MS as fromRevoke } from '../src/consents/revoke.js'
import { NEBRAS_SLA_MS as fromBulkRevoke } from '../src/consents/bulk-revoke.js'
import { DemoSloReader } from '../src/analytics/slo.js'
// Build/test-time spec access, on the same subpath family as `@ofbo/contracts/testing` —
// deliberately NOT the runtime index, which Workers load and which must stay generated-artifacts
// only (packages/contracts/src/spec.ts).
import { readFileSync } from 'node:fs'
import { loadSpec, SPEC_PATH } from '@ofbo/contracts/spec'

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
    const { readdirSync } = await import('node:fs')
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
   * machine-readable (`x-nfr18-exclusive-max-ms`, the same vendor-extension mechanism the spec
   * already uses for `x-required-scope` and `x-four-eyes`) and this test is the link.
   */
  it('agrees with the contract, which states the same bound machine-readably', () => {
    const spec = loadSpec()
    const field =
      spec.components.responses.RevocationResult.content['application/json'].schema.allOf[1].properties.data
        .properties.nebras_propagation_ms
    expect(field['x-nfr18-exclusive-max-ms']).toBe(NEBRAS_SLA_MS)
    // The human-readable half must carry the same number as the machine-readable half — a
    // description that drifts from its own extension is the original defect in miniature.
    expect(field.description).toContain(String(NEBRAS_SLA_MS))
  })

  /**
   * The VALUE agreeing is not the whole claim — the COMPARATOR has to agree too.
   *
   * The first cut of this asserted the integers matched and that the description mentioned the
   * number. Both pass on `p99 ≤ 5000 ms`, which is a different bound: every comparator that decides
   * conformance is strict (`< NEBRAS_SLA_MS` in revoke.ts, fraud-revoke.ts and bulk-revoke.ts), so
   * an acknowledgment landing exactly on the bound is a breach to the code and conformant to a
   * consumer reading an inclusive `max`. A one-millisecond window — and precisely the
   * machine-versus-prose disagreement this story exists to remove, reintroduced by a key NAME.
   *
   * So the exclusivity is asserted on both halves: the extension carries it in its key, and the
   * description states it in words.
   */
  it('agrees about the COMPARATOR, not only the magnitude', () => {
    const spec = loadSpec()
    const field =
      spec.components.responses.RevocationResult.content['application/json'].schema.allOf[1].properties.data
        .properties.nebras_propagation_ms
    // Exactly one NFR-18 extension, and it names the bound exclusive.
    //
    // The first cut asserted only that the literal `x-nfr18-p99-max-ms` was absent, under a comment
    // claiming no inclusive-sounding key may reappear — `x-nfr18-max-ms` or
    // `x-nfr18-p99-inclusive-max-ms` both satisfied it, and an inclusive key added ALONGSIDE the
    // exclusive one (the worst state of the three) passed. Same overclaim shape as the one a few
    // lines up was written to correct: the comment described a guard that did not exist.
    const nfr18Keys = Object.keys(field).filter((k) => /^x-nfr18-/.test(k))
    expect(nfr18Keys, 'exactly one NFR-18 extension on this field').toHaveLength(1)
    expect(nfr18Keys[0]).toMatch(/exclusive-max-ms$/)
    // And the prose says strictly-less-than rather than at-most — the PROPERTY, not one spelling.
    // The first cut required the literal `<`, which this suite then rejected when the description
    // was reworded to "STRICTLY BELOW 5000 ms": a stricter statement of the same bound, failed by a
    // guard pinning punctuation instead of meaning.
    expect(field.description).toMatch(new RegExp(`(?:<|strictly below|strictly less than)\\s*(?:the bound|${NEBRAS_SLA_MS})`, 'i'))
    expect(field.description).toContain(String(NEBRAS_SLA_MS))
    expect(field.description).not.toMatch(/≤|<=|at most|no more than/)
  })

  /**
   * ONE stated bound in the node, and the test binds every statement of it.
   *
   * The acceptance criterion is "states the revoke-SLA bound in exactly one place". The schema node
   * necessarily states it twice — machine-readable and human-readable — and both are bound above.
   * What must never appear is a THIRD that nothing compares: that is the original defect at smaller
   * scale, and my own first YAML comment for this change contained one.
   *
   * SCOPED TO THE NODE, not the document. The first cut scanned all 3,900 lines for `5000`, which
   * couples this guard to every unrelated author: `x-rate-limit-per-min`, a `maxLength`, or money in
   * integer minor units (where 5000 is AED 50.00) would fail it with a false accusation about
   * NFR-18. The claim was always about this node; now the implementation is too.
   *
   * UNIT-AWARE, because the copy STD-09 missed was in a different unit. This file's own history
   * records it: the third code copy was the prose "< 5s" in an SLO description, and "a grep for
   * `5000` never finds the SLO row". A guard that greps for `5000` is that same grep, one artifact
   * over — and the contract's surrounding prose already speaks in hours and seconds. So it matches
   * the bound however it is spelled.
   */
  it('states the bound nowhere in its own schema node that a test does not bind', () => {
    const raw = readFileSync(SPEC_PATH, 'utf8')
    const lines = raw.split('\n')

    // STRUCTURAL, not positional. The first cut used a document-wide `findIndex` for the first
    // `nebras_propagation_ms:` line. In the SPEC that string occurs exactly once today, so the risk
    // is prospective, not present: the fraud and bulk routes emit a field of the same name on their
    // free-form `execution_result`, and BACKOFFICE-93 proposes giving those a schema. The day one
    // lands above this node, a positional guard silently retargets and leaves RevocationResult
    // unguarded with every test still green. Anchor on the response this node belongs to.
    //
    // Stated in that order because an earlier version of this comment said `nebras_propagation_ms`
    // "already appears" on those payloads — true of the runtime wire, false of the YAML this guard
    // scans, which is the only thing the anchoring argument is about. The mitigation was right and
    // its stated reason was not.
    const anchor = lines.findIndex((l) => /^\s*RevocationResult:/.test(l))
    expect(anchor, 'the RevocationResult response must be findable').toBeGreaterThan(-1)
    const start = lines.findIndex((l, i) => i > anchor && /^\s*nebras_propagation_ms:/.test(l))
    expect(start, 'the field must be findable inside RevocationResult').toBeGreaterThan(anchor)

    const indent = lines[start]!.search(/\S/)
    let end = start + 1
    while (end < lines.length && (lines[end]!.trim() === '' || lines[end]!.search(/\S/) > indent)) end++

    // Escaped: at a non-round bound (2500 → `2.5`) the `.` would interpolate as a wildcard.
    const seconds = String(NEBRAS_SLA_MS / 1000).replace('.', '\\.')
    const grouped = String(NEBRAS_SLA_MS).replace(/\B(?=(\d{3})+$)/g, '[,_ ]?')
    // Every spelling of the same bound — and "every" now means it.
    //
    // The first cut used `\b5000\b`, which does NOT match `5000ms`: there is no word boundary
    // between a digit and a letter. So the most natural way anyone would write the bound slipped
    // through a guard whose comment promised every spelling, and `5,000` / `5 000` did too. The
    // digit-adjacency lookarounds replace the word boundaries — they still exclude `15000` and
    // `50000`, which is what `\b` was there for.
    const anySpelling = new RegExp(
      `(?<![\\d.])(?:${NEBRAS_SLA_MS}|${grouped})(?!\\d)`
      + `|(?<![\\d.])${seconds}(?:e3\\b|\\s*m?s\\b|\\s*seconds?\\b)`,
      'gi'
    )

    // STATEMENTS, not lines. Counting lines said "two" while the description states the number
    // twice on one of them — so a fourth statement appended to an existing line passed a guard
    // whose own comment claimed it caught exactly that. Count every occurrence.
    const statements = lines
      .slice(start, end)
      .reduce((n, l) => n + (l.match(anySpelling) ?? []).length, 0)

    // Three: the extension, and the description's two ("strictly below 5000 ms", "exactly 5000").
    // Each is asserted by the tests above; a fourth would be an unbound copy.
    expect(statements, 'an unbound statement of the bound appeared in this node').toBe(3)
  })

  /**
   * ...and states no OTHER duration either — the half the count above cannot see.
   *
   * The acceptance criterion this suite is cited for reads "a test fails if the two disagree, so an
   * amendment cannot land in one and not the other". It did not hold, and I verified that by walking
   * the amendment rather than by reading the assertions: with `NEBRAS_SLA_MS` moved to 3000, its
   * literal pin updated, the extension updated, the description reworded to 3000 and the sentence
   * "Prior to the amendment this bound was 5000 ms" left behind, all eight tests passed.
   *
   * Every assertion in this file is parameterised on the CURRENT constant, so each one asks "is the
   * new number here?" and none asks "is any other number here?". The published contract could
   * therefore go on telling integrators 5000 while the services enforced 3000 — which is verbatim
   * the defect BACKOFFICE-91 was filed against, surviving inside the guard written to close it.
   *
   * So this reads the node the other way round: find every duration-shaped quantity, and require
   * each one to BE the bound. Unit-aware for the same reason the count above is — the copy STD-09
   * missed was in a different unit.
   */
  it('states no duration in its own schema node that is not the bound', () => {
    const raw = readFileSync(SPEC_PATH, 'utf8')
    const lines = raw.split('\n')
    const anchor = lines.findIndex((l) => /^\s*RevocationResult:/.test(l))
    const start = lines.findIndex((l, i) => i > anchor && /^\s*nebras_propagation_ms:/.test(l))
    expect(start, 'the field must be findable inside RevocationResult').toBeGreaterThan(anchor)
    const indent = lines[start]!.search(/\S/)
    let end = start + 1
    while (end < lines.length && (lines[end]!.trim() === '' || lines[end]!.search(/\S/) > indent)) end++

    // `0` is the training sentinel, documented in this very node as "not a measurement". Allowed by
    // NAME rather than by a rule that quietly tolerates small numbers, so adding another exemption
    // is a visible edit.
    const DOCUMENTED_NON_BOUND = new Set([0])

    // A number that stands on its own, carrying an optional time unit. The lookbehind is what keeps
    // identifiers out: `NFR-18` and `p99` are requirement and statistic names, not durations, and
    // both are preceded by a letter or a hyphen.
    const quantity = /(?<![A-Za-z\d.-])(\d[\d,_ ]*\d|\d)\s*(ms|milliseconds?|s|seconds?)?\b/gi

    const strays: string[] = []
    for (const line of lines.slice(start, end)) {
      for (const [text, digits, unit] of line.matchAll(quantity)) {
        const n = Number(digits!.replace(/[,_ ]/g, ''))
        const ms = /^s/i.test(unit ?? '') ? n * 1000 : n
        if (ms !== NEBRAS_SLA_MS && !DOCUMENTED_NON_BOUND.has(ms)) strays.push(`${text.trim()} (→ ${ms} ms)`)
      }
    }
    expect(strays, 'a duration that is not the NFR-18 bound appears in this node').toEqual([])
  })

  /**
   * ...and neither does the FILE HEADER, which is the region the two guards above cannot see.
   *
   * Both are scoped to the field's schema node, deliberately — a document-wide scan for the bare
   * number fired on unrelated rate limits and minor-unit money and accused their authors of NFR-18
   * drift. But this same change added a paragraph to the file header that discusses
   * `nebras_propagation_ms` and its NFR-18 bound, which created a new home for exactly the copy the
   * guards exist to prevent, in the one region they do not reach. The advisory reviewer caught it and
   * confirmed there is no live drift: the header states no number today.
   *
   * "States none today" is the property worth holding, so it is held here rather than noticed. The
   * header is bounded and cheap to scan, unlike the document, so this is the narrow extension that
   * does not bring the false-positive problem back with it.
   */
  it('states no duration in the file header either, where the node guards cannot see', () => {
    const raw = readFileSync(SPEC_PATH, 'utf8')
    // The leading comment block — everything before the first non-comment line.
    const header = raw.split('\n').slice(0, raw.split('\n').findIndex((l) => !l.startsWith('#')))
    expect(header.length, 'the header comment block must be findable').toBeGreaterThan(3)

    const quantity = /(?<![A-Za-z\d.-])(\d[\d,_ ]*\d|\d)\s*(ms|milliseconds?|s|seconds?)?\b/gi
    const strays: string[] = []
    for (const line of header) {
      for (const [text, digits, unit] of line.matchAll(quantity)) {
        const n = Number(digits!.replace(/[,_ ]/g, ''))
        const ms = /^s/i.test(unit ?? '') ? n * 1000 : n
        // A number counts only if it is stated AS a duration (carries a time unit) or IS the bound
        // written bare. The first cut flagged every numeral and caught `PRD §7` and `ADR 0034` —
        // this header cites sections and records, so a guard that cannot tell a citation from a
        // threshold is one nobody can leave switched on.
        if (unit || ms === NEBRAS_SLA_MS) strays.push(`${text.trim()} (→ ${ms} ms)`)
      }
    }
    // No duration at all, not "no wrong duration": the header's job is to say the bound is carried
    // and where, never to restate it.
    expect(strays, 'the file header states a duration, outside every node-scoped guard').toEqual([])
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
