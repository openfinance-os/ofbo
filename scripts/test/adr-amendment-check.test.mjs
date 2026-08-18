// ADR 0030 — guard tests for the accepted-ADR amendment rule.
//
// The test that earns its place is the ANTI-VACUOUS-PASS one: a gate that cannot go red is not
// a gate. ADR 0007 is the reason this check exists — accepted, then substantively corrected the
// same day with nothing on the document saying so — so the suite drives that exact shape and
// asserts it FAILS.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isAdrPath,
  statusOf,
  isAccepted,
  isSuperseded,
  addsAmendmentRow,
  AMENDMENT_ROW,
  violations,
  parseNameStatus,
} from '../adr-amendment-check.mjs'

const accepted = '# ADR 0007 — x\n\n- Status: **Accepted** — Option 1 (user decision, 2026-08-17)\n\n## Context\n'
const proposed = '# ADR 0011 — x\n\n- Status: **Proposed** — awaiting human decision\n'
const superseded = '# ADR 0012 — x\n\n- Status: **Superseded by ADR 0016** (2026-06-21)\n'

test('ADR paths are recognised by the NNNN- prefix', () => {
  assert.ok(isAdrPath('docs/adrs/0030-adr-amendment-convention.md'))
  assert.ok(!isAdrPath('docs/adrs/README.md'))
  assert.ok(!isAdrPath('docs/build-log.md'))
})

test('status is read from the first Status: line', () => {
  assert.match(statusOf(accepted), /accepted/)
  assert.ok(isAccepted(accepted))
  assert.ok(!isAccepted(proposed))
  assert.ok(isSuperseded(superseded))
  // A doc with no Status line is not accepted, so it cannot trip the rule.
  assert.ok(!isAccepted('# ADR 0004 — no status line\n'))
})

test('an amendment row is a table row whose first cell is an ISO date', () => {
  assert.ok(AMENDMENT_ROW.test('| 2026-08-18 | engine table corrected |'))
  assert.ok(AMENDMENT_ROW.test('  |  2026-08-18  | spaced |'))
  // Not rows: the table header, a prose date, a bare bullet.
  assert.ok(!AMENDMENT_ROW.test('| date | amendment |'))
  assert.ok(!AMENDMENT_ROW.test('On 2026-08-18 we corrected the engine table.'))
  assert.ok(!AMENDMENT_ROW.test('- 2026-08-18 corrected the engine table'))
  // the helper the rule actually calls, over a realistic added-line set
  assert.ok(addsAmendmentRow(['## Context', '| 2026-08-18 | corrected |']))
  assert.ok(!addsAmendmentRow(['## Context', '| date | amendment |']))
})

test('ANTI-VACUOUS-PASS: the ADR 0007 shape — accepted, corrected, unrecorded — FAILS', () => {
  // Exactly what commit 0f0a79a did: substantive edits to an accepted ADR, no amendment row.
  const bad = violations([
    {
      path: 'docs/adrs/0007-tpp-of-record-payables-net-settlement.md',
      baseText: accepted,
      headText: accepted,
      addedLines: [
        '4. **VAT posture (payable side).** Accrue net of VAT; recognise input VAT only on a',
        '   valid tax invoice.',
      ],
    },
  ])
  assert.deepEqual(bad, ['docs/adrs/0007-tpp-of-record-payables-net-settlement.md'])
})

test('the same edit WITH a dated amendment row passes', () => {
  const ok = violations([
    {
      path: 'docs/adrs/0007-x.md',
      baseText: accepted,
      headText: accepted,
      addedLines: [
        '### Amendments after acceptance',
        '| 2026-08-17 | VAT posture corrected — accrue net of VAT, not VAT-inclusive. |',
      ],
    },
  ])
  assert.deepEqual(ok, [])
})

test('superseding instead of amending is the other permitted route', () => {
  const ok = violations([
    { path: 'docs/adrs/0012-x.md', baseText: accepted, headText: superseded, addedLines: ['x'] },
  ])
  assert.deepEqual(ok, [])
})

test('a Proposed ADR is exempt — the rule attaches at acceptance', () => {
  const ok = violations([
    { path: 'docs/adrs/0011-x.md', baseText: proposed, headText: proposed, addedLines: ['x'] },
  ])
  assert.deepEqual(ok, [])
})

test('an existing amendment table does NOT satisfy a fresh unrecorded edit', () => {
  // The row must be ADDED by this diff. Base already having a table is not a licence to edit
  // silently forever after — the regression that would quietly gut this gate.
  const withTable = accepted + '\n### Amendments after acceptance\n| 2026-01-01 | old |\n'
  const bad = violations([
    {
      path: 'docs/adrs/0029-x.md',
      baseText: withTable,
      headText: withTable,
      addedLines: ['some substantive new claim, no new row'],
    },
  ])
  assert.deepEqual(bad, ['docs/adrs/0029-x.md'])
})

test('several ADRs in one PR are judged independently', () => {
  const bad = violations([
    { path: 'a.md', baseText: accepted, headText: accepted, addedLines: ['| 2026-08-18 | ok |'] },
    { path: 'b.md', baseText: accepted, headText: accepted, addedLines: ['unrecorded'] },
    { path: 'c.md', baseText: proposed, headText: proposed, addedLines: ['draft'] },
  ])
  assert.deepEqual(bad, ['b.md'])
})

test('REGRESSION: a renamed accepted ADR is still examined', () => {
  // Filtering on status 'M' exactly let rename-plus-edit walk past the gate — git reports
  // R100/R087 for a rename, never M, so the cheapest bypass was to rename the file in the same
  // commit. Found by the hard-stop reviewer on PR #324, which reproduced it in a scratch repo.
  const renamed = parseNameStatus('R100\tdocs/adrs/0007-old-name.md\tdocs/adrs/0007-new-name.md')
  assert.deepEqual(renamed, [
    { path: 'docs/adrs/0007-new-name.md', basePath: 'docs/adrs/0007-old-name.md' },
  ])
  // base text must come from the OLD path — the new one does not exist on base
  assert.equal(renamed[0].basePath, 'docs/adrs/0007-old-name.md')
})

test('name-status parsing: M included, A and D exempt, C treated as a rename', () => {
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
