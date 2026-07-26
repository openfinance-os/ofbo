// HARNESS-06 — unit cover for the ADR number reservation rule. The git/GitHub plumbing is
// exercised end-to-end in CI; what is worth pinning here is the collision RULE itself, since
// that is what decides whether a merge is blocked.
import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { adrNumber, collisions, peerAdrs } from '../adr-number-check.mjs'

/** A fake GitHub that records the URLs it was asked for. */
const fakeGitHub = (routes) => {
  const seen = []
  const doFetch = async (url) => {
    seen.push(url)
    const body = Object.entries(routes).find(([frag]) => url.includes(frag))?.[1]
    if (body === undefined) return { ok: false, status: 404, statusText: 'Not Found' }
    if (body instanceof Error) throw body
    return { ok: true, status: 200, statusText: 'OK', json: async () => body }
  }
  return { doFetch, seen }
}

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

// --- peer-check plumbing -----------------------------------------------------------------
// The pure rule above decides IF something collides; these cover what is fed INTO it. Without
// them the API path would ship never having executed — it soft-skips on error, so a bug here
// would silently mean "never catches anything" rather than a visible failure.

test('peer check queries open PRs and only reads files of EARLIER ones', async () => {
  const { doFetch, seen } = fakeGitHub({
    '/pulls?state=open': [{ number: 40 }, { number: 60 }, { number: 41 }],
    '/pulls/40/files': [{ filename: 'docs/adrs/0031-a.md', status: 'added' }],
    '/pulls/41/files': [{ filename: 'docs/adrs/0032-b.md', status: 'added' }]
  })
  const claimed = await peerAdrs('o/r', 'tok', 50, doFetch)

  assert.deepEqual(
    claimed.map((c) => [c.number, c.source]),
    [
      ['0031', 'PR #40'],
      ['0032', 'PR #41']
    ]
  )
  // #60 is newer than #50, so this PR keeps its claim and #60's files are never fetched.
  assert.equal(
    seen.some((u) => u.includes('/pulls/60/files')),
    false
  )
  assert.equal(seen[0], 'https://api.github.com/repos/o/r/pulls?state=open&per_page=100')
})

test('peer check ignores removed files and non-ADR paths', async () => {
  const { doFetch } = fakeGitHub({
    '/pulls?state=open': [{ number: 10 }],
    '/pulls/10/files': [
      { filename: 'docs/adrs/0027-deleted.md', status: 'removed' }, // freed, not claimed
      { filename: 'docs/adrs/README.md', status: 'added' }, // not numbered
      { filename: 'docs/proposals/0027-not-an-adr.md', status: 'added' }, // wrong directory
      { filename: 'docs/adrs/0033-real.md', status: 'added' }
    ]
  })
  const claimed = await peerAdrs('o/r', 'tok', 99, doFetch)
  assert.deepEqual(
    claimed.map((c) => c.path),
    ['docs/adrs/0033-real.md']
  )
})

test('peer check surfaces API failure to the caller (which soft-skips)', async () => {
  const { doFetch } = fakeGitHub({}) // every route 404s
  await assert.rejects(() => peerAdrs('o/r', 'tok', 5, doFetch), /404/)

  const { doFetch: throwing } = fakeGitHub({ '/pulls?state=open': new Error('ECONNRESET') })
  await assert.rejects(() => peerAdrs('o/r', 'tok', 5, throwing), /ECONNRESET/)
})

test('peer claims feed the collision rule end to end', async () => {
  const { doFetch } = fakeGitHub({
    '/pulls?state=open': [{ number: 295 }],
    '/pulls/295/files': [
      { filename: 'docs/adrs/0027-ozone-channel-si-distribution.md', status: 'added' }
    ]
  })
  // The real #294-vs-#295 case, driven through the API path rather than a literal.
  const found = collisions(
    ['docs/adrs/0027-multi-tenant-tenancy-model.md'],
    await peerAdrs('openfinance-os/ofbo', 'tok', 296, doFetch)
  )
  assert.equal(found.length, 1)
  assert.equal(found[0].source, 'PR #295')
})
