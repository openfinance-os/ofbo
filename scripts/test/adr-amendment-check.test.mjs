// ADR 0030 — guard tests for the accepted-ADR amendment rule.
//
// The test that earns its place is the ANTI-VACUOUS-PASS one: a gate that cannot go red is not
// a gate. ADR 0007 is the reason this check exists — accepted, then substantively corrected the
// same day with nothing on the document saying so — so the suite drives that exact shape and
// asserts it FAILS.
//
// The rest of the suite is a regression record. Every test tagged FINDING-n pins a bypass the
// hard-stop reviewer REPRODUCED against the first version of this gate on PR #324; each one was
// a way to change an accepted ADR with the gate reporting green.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isAdrPath,
  adrNumber,
  statusValue,
  isAccepted,
  isSuperseded,
  AMENDMENT_ROW,
  stripFences,
  amendmentRows,
  hasNewAmendmentRow,
  violations,
  parseNameStatus,
} from '../adr-amendment-check.mjs'

const accepted =
  '# ADR 0007 — x\n\n- Status: **Accepted — Option 1** (user decision, 2026-08-17)\n\n## Context\n'
const proposed = '# ADR 0011 — x\n\n- Status: **Proposed** — awaiting human decision\n'
const superseded = '# ADR 0012 — x\n\n- Status: **Superseded by ADR 0016** (2026-06-21)\n'
/** The real ADR 0004 / 0005 form: emphasis wraps the whole `Status:` label. */
const boldLabel = '# ADR 0004 — x\n\n- **Status:** Accepted (2026-06-18)\n'

/** An ADR carrying an amendments table with one row. */
const withRow = (date) =>
  `${accepted}\n### Amendments after acceptance\n\n| date | amendment |\n| --- | --- |\n| ${date} | corrected a fact |\n`

test('an ADR is docs/adrs/NNNN-*.md — both halves', () => {
  assert.ok(isAdrPath('docs/adrs/0030-adr-amendment-convention.md'))
  assert.ok(!isAdrPath('docs/adrs/README.md'), 'wrong basename shape')
  assert.ok(!isAdrPath('docs/build-log.md'))
  // The directory half is load-bearing: it is what makes a move OUT of docs/adrs/ visible as a
  // rename of an ADR rather than as a bare deletion (finding 2).
  assert.ok(!isAdrPath('docs/0007-moved-out.md'), 'right shape, wrong directory')
  assert.equal(adrNumber('docs/adrs/0007-tpp-payables.md'), '0007')
  assert.equal(adrNumber('docs/adrs/README.md'), null)
})

test('FINDING-1/2: a rename is scoped on the OLD path, wherever it lands', () => {
  // Testing the DESTINATION let a rename out of the ADR shape walk past the gate entirely.
  // Both of these were reproduced live on PR #324 and both exited 0 before this fix.

  // 1: renamed to a filename that no longer matches NNNN-*.md
  assert.deepEqual(
    parseNameStatus('R051\tdocs/adrs/0007-payables.md\tdocs/adrs/adr-0007-payables.md'),
    [{ path: 'docs/adrs/adr-0007-payables.md', basePath: 'docs/adrs/0007-payables.md' }],
  )

  // 2: moved out of docs/adrs/ entirely
  assert.deepEqual(parseNameStatus('R100\tdocs/adrs/0007-payables.md\tdocs/0007-payables.md'), [
    { path: 'docs/0007-payables.md', basePath: 'docs/adrs/0007-payables.md' },
  ])

  // The converse stays exempt: a non-ADR file renamed INTO the ADR shape is a new record,
  // not a modification of an accepted one.
  assert.deepEqual(parseNameStatus('R100\tdocs/notes/draft.md\tdocs/adrs/0031-new.md'), [])
})

test('FINDING-1: the bold `- **Status:**` form is read, not silently exempted', () => {
  // ADRs 0004 and 0005 use this form. The original regex required `Status:` to follow only
  // optional whitespace and a hyphen, so both were permanently invisible to the gate — and the
  // failure was silent: the gate counted them and printed the green "each recorded" line.
  assert.ok(isAccepted(boldLabel), 'bold-label ADR must classify as Accepted')
  assert.ok(isAccepted(accepted), 'plain-label ADR still classifies as Accepted')
  assert.equal(statusValue(boldLabel), 'accepted (2026-06-18)')
  // A doc with no Status line is not accepted, so it cannot trip the rule.
  assert.ok(!isAccepted('# ADR 0099 — no status line\n'))
  assert.equal(statusValue('# ADR 0099 — no status line\n'), '')
})

test('FINDING-6: status is anchored to the VALUE, not any word on the line', () => {
  // ADR 0012's real line contains BOTH "Superseded" and "Accepted":
  //   - Status: **Superseded by ADR 0016** (2026-06-21) — was "Accepted — Option 1"
  // Matching either word anywhere made every future edit of 0012 exempt.
  const adr0012 =
    '# ADR 0012 — x\n\n- Status: **Superseded by ADR 0016** (2026-06-21) — was "Accepted — Option 1" (user decision)\n'
  assert.ok(isSuperseded(adr0012), '0012 reads as superseded')
  assert.ok(!isAccepted(adr0012), '0012 must NOT read as accepted')

  // The mirror case: "superseded" appearing in prose must not exempt an ACCEPTED ADR.
  const acceptedProse =
    '# ADR 0031 — x\n\n- Status: **Accepted** (2026-08-18) — superseded the interim guidance\n'
  assert.ok(isAccepted(acceptedProse))
  assert.ok(!isSuperseded(acceptedProse), 'prose "superseded" must not exempt an accepted ADR')

  assert.ok(isSuperseded(superseded))
  assert.ok(!isAccepted(proposed))
})

test('an amendment row is a table row whose first cell is an ISO date', () => {
  assert.ok(AMENDMENT_ROW.test('| 2026-08-18 | engine table corrected |'))
  assert.ok(AMENDMENT_ROW.test('  |  2026-08-18  | spaced |'))
  // Not rows: the table header, a prose date, a bare bullet.
  assert.ok(!AMENDMENT_ROW.test('| date | amendment |'))
  assert.ok(!AMENDMENT_ROW.test('On 2026-08-18 we corrected the engine table.'))
  assert.ok(!AMENDMENT_ROW.test('- 2026-08-18 corrected the engine table'))
})

test('FINDING-5: rows only count under the Amendments heading, outside code fences', () => {
  // The original check matched a dated row ANYWHERE in the added lines. ADR 0030 itself carries
  // a qualifying row inside a fenced example, so the shape is reachable in ordinary ADR prose.
  const fenced = `${accepted}\n### Amendments after acceptance\n\n\`\`\`\n| 2026-08-18 | example row inside a fence |\n\`\`\`\n`
  assert.equal(amendmentRows(fenced).size, 0, 'a fenced row is not an amendment')
  assert.ok(!stripFences(fenced).includes('example row inside a fence'))

  const wrongSection = `${accepted}\n### Verification timeline\n\n| 2026-08-18 | ran the suite |\n`
  assert.equal(amendmentRows(wrongSection).size, 0, 'a row under another heading is not an amendment')

  assert.deepEqual([...amendmentRows(withRow('2026-08-18'))], ['| 2026-08-18 | corrected a fact |'])
  // The heading ends at the next heading of any level.
  const afterSection = `${withRow('2026-08-18')}\n## Context\n\n| 2026-09-01 | not an amendment |\n`
  assert.deepEqual([...amendmentRows(afterSection)], ['| 2026-08-18 | corrected a fact |'])
})

test('FALSE-RED REGRESSION: a second amendment on the SAME DAY is a new row', () => {
  // The set was keyed on the ISO date alone, so a second genuine amendment made on the same
  // calendar day read as "already there" and false-RED a compliant PR. ADR 0007 already carries
  // two rows dated 2026-08-17, so this was days from biting. A false red on correct work is
  // worse than most bypasses: it blocks the right change and teaches people the gate is noise.
  const base = withRow('2026-08-18')
  const sameDaySecondRow = `${base}| 2026-08-18 | a SECOND, different correction the same day |\n`
  assert.ok(hasNewAmendmentRow(base, sameDaySecondRow), 'same-day second row must count as new')

  // The finding-2 guarantee must survive: an identical carried-over row is still not new.
  assert.ok(!hasNewAmendmentRow(base, `${base}\nprose edit, no new row\n`))
  // Whitespace-only reformatting of an existing row is not a new amendment either.
  const reflowed = base.replace('| 2026-08-18 | corrected a fact |', '|  2026-08-18  |  corrected a fact  |')
  assert.ok(!hasNewAmendmentRow(base, reflowed), 'reformatting a row is not an amendment')
})

test('ANTI-VACUOUS-PASS: the ADR 0007 shape — accepted, corrected, unrecorded — FAILS', () => {
  // Exactly what commit 0f0a79a did: substantive edits to an accepted ADR, no amendment row.
  const bad = violations([
    {
      path: 'docs/adrs/0007-tpp-of-record-payables-net-settlement.md',
      baseText: accepted,
      headText: `${accepted}\n4. **VAT posture.** Accrue net of VAT.\n`,
    },
  ])
  assert.deepEqual(bad, ['docs/adrs/0007-tpp-of-record-payables-net-settlement.md'])
})

test('the same edit WITH a new dated amendment row passes', () => {
  const ok = violations([
    { path: 'docs/adrs/0007-x.md', baseText: accepted, headText: withRow('2026-08-17') },
  ])
  assert.deepEqual(ok, [])
})

test('FINDING-2: a carried-over row does NOT satisfy a fresh edit (the rename bypass)', () => {
  // The half-closed fix diffed only the NEW path, which suppressed git's rename detection: the
  // whole file read as added, so a PRE-EXISTING row counted as newly added and rename-plus-edit
  // passed for exactly the ADRs that already carry a table (0007, 0029). Comparing row SETS
  // between base and head closes it without parsing a diff at all.
  const base = withRow('2026-08-17')
  const head = `${base}\nA substantive new claim, with no new row.\n`
  assert.ok(!hasNewAmendmentRow(base, head), 'the row exists in BOTH — it is not new')
  assert.deepEqual(violations([{ path: 'docs/adrs/0007-x.md', baseText: base, headText: head }]), [
    'docs/adrs/0007-x.md',
  ])
  // Adding a genuinely new row on top of an existing table does satisfy it.
  const withSecond = `${base}| 2026-08-18 | a second, newer correction |\n`
  assert.ok(hasNewAmendmentRow(base, withSecond))
})

test('superseding instead of amending is the other permitted route', () => {
  const ok = violations([
    { path: 'docs/adrs/0012-x.md', baseText: accepted, headText: superseded },
  ])
  assert.deepEqual(ok, [])
})

test('a Proposed ADR is exempt — the rule attaches at acceptance', () => {
  const ok = violations([
    { path: 'docs/adrs/0011-x.md', baseText: proposed, headText: `${proposed}\nedited\n` },
  ])
  assert.deepEqual(ok, [])
})

test('several ADRs in one PR are judged independently', () => {
  const bad = violations([
    { path: 'a.md', baseText: accepted, headText: withRow('2026-08-18') },
    { path: 'b.md', baseText: accepted, headText: `${accepted}\nunrecorded\n` },
    { path: 'c.md', baseText: proposed, headText: `${proposed}\ndraft edit\n` },
  ])
  assert.deepEqual(bad, ['b.md'])
})

test('REGRESSION: a renamed accepted ADR is still examined', () => {
  // Filtering on status 'M' exactly let rename-plus-edit walk past the gate — git reports
  // R100/R087 for a rename, never M. Base text must come from the OLD path.
  const renamed = parseNameStatus('R100\tdocs/adrs/0007-old-name.md\tdocs/adrs/0007-new-name.md')
  assert.deepEqual(renamed, [
    { path: 'docs/adrs/0007-new-name.md', basePath: 'docs/adrs/0007-old-name.md' },
  ])
})

test('FINDING-3: delete + re-add of the same ADR number is a modification, not a deletion', () => {
  // Below git's rename-similarity threshold a full rewrite reports a separate D and A. Both were
  // dropped, so an accepted decision record could be wholly rewritten with the gate reporting
  // "nothing to check". Pairing on the ADR number catches it; base text comes from the deleted
  // path, which still exists on base.
  const paired = parseNameStatus(
    ['D\tdocs/adrs/0008-plain.md', 'A\tdocs/adrs/0008-rewritten.md'].join('\n'),
  )
  assert.deepEqual(paired, [
    { path: 'docs/adrs/0008-rewritten.md', basePath: 'docs/adrs/0008-plain.md' },
  ])

  // An unrelated D and A (different numbers) is a real deletion plus a real addition — both
  // exempt, per ADR 0030's stated carve-out.
  const unrelated = parseNameStatus(
    ['D\tdocs/adrs/0008-gone.md', 'A\tdocs/adrs/0031-brand-new.md'].join('\n'),
  )
  assert.deepEqual(unrelated, [])
})

test('name-status parsing: M included, lone A and D exempt, C treated as a rename', () => {
  const parsed = parseNameStatus(
    [
      'M\tdocs/adrs/0007-a.md',
      'A\tdocs/adrs/0030-new.md',
      'D\tdocs/adrs/0011-gone.md',
      'C075\tdocs/adrs/0005-src.md\tdocs/adrs/0031-copy.md',
      'M\tdocs/adrs/README.md',
    ].join('\n'),
  )
  assert.deepEqual(parsed, [
    { path: 'docs/adrs/0007-a.md', basePath: 'docs/adrs/0007-a.md' },
    { path: 'docs/adrs/0031-copy.md', basePath: 'docs/adrs/0005-src.md' },
  ])
})
