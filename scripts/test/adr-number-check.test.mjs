// HARNESS-06 — unit cover for the ADR number reservation rule. The git/GitHub plumbing is
// exercised end-to-end in CI; what is worth pinning here is the collision RULE itself, since
// that is what decides whether a merge is blocked.
import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { adrNumber, collisions } from '../adr-number-check.mjs'

const claim = (path, source = 'base (origin/main)') => ({
  number: adrNumber(path),
  path,
  source
})

test('adrNumber extracts a four-digit prefix and rejects non-ADRs', () => {
  assert.equal(adrNumber('docs/adrs/0027-multi-tenant-tenancy-model.md'), '0027')
  assert.equal(adrNumber('docs/adrs/0001-a.md'), '0001')
  assert.equal(adrNumber('docs/adrs/README.md'), null)
  assert.equal(adrNumber('docs/adrs/027-too-short.md'), null)
  assert.equal(adrNumber('docs/adrs/0027-no-extension'), null)
})

test('the real 2026-07-22 collision is caught', () => {
  // #294 adds the tenancy ADR while #295 (opened earlier) already claims 0027.
  const found = collisions(
    ['docs/adrs/0027-multi-tenant-tenancy-model.md'],
    [claim('docs/adrs/0027-ozone-channel-si-distribution.md', 'PR #295')]
  )
  assert.equal(found.length, 1)
  assert.equal(found[0].number, '0027')
  assert.equal(found[0].source, 'PR #295')
  assert.equal(found[0].theirs, 'docs/adrs/0027-ozone-channel-si-distribution.md')
})

test('a free number passes', () => {
  const found = collisions(
    ['docs/adrs/0028-multi-tenant-tenancy-model.md'],
    [claim('docs/adrs/0027-ozone-channel-si-distribution.md', 'PR #295')]
  )
  assert.deepEqual(found, [])
})

test('the SAME file arriving from both sides is not a collision', () => {
  // A merged/rebased branch sees its own ADR on base. Renaming must not self-trip.
  const path = 'docs/adrs/0028-multi-tenant-tenancy-model.md'
  assert.deepEqual(collisions([path], [claim(path)]), [])
})

test('non-ADR files in docs/adrs are ignored', () => {
  assert.deepEqual(collisions(['docs/adrs/README.md'], [claim('docs/adrs/0027-x.md')]), [])
})

test('one contended number against several holders reports each', () => {
  const found = collisions(
    ['docs/adrs/0027-mine.md'],
    [claim('docs/adrs/0027-a.md', 'PR #1'), claim('docs/adrs/0027-b.md', 'base (origin/main)')]
  )
  assert.equal(found.length, 2)
  assert.deepEqual(
    found.map((f) => f.source).sort(),
    ['PR #1', 'base (origin/main)']
  )
})

test('several added ADRs are each checked', () => {
  const found = collisions(
    ['docs/adrs/0031-ok.md', 'docs/adrs/0032-clash.md'],
    [claim('docs/adrs/0032-taken.md', 'PR #7')]
  )
  assert.equal(found.length, 1)
  assert.equal(found[0].mine, 'docs/adrs/0032-clash.md')
})
