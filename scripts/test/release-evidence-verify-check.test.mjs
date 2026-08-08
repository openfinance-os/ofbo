// HARNESS-15 guard: the release workflow must re-verify the sealed bundle, and must do it
// BEFORE committing. verifyEvidenceBundle() sat exported and unit-tested with no caller for
// its whole life — the seal was written and never checked again — so the step that closes
// that is asserted here, in a suite CI always runs. Ordering is the load-bearing part: a
// verification that runs after the commit cannot stop a corrupt bundle reaching git.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const wf = readFileSync(join(root, '.github', 'workflows', 'release-evidence.yml'), 'utf8')

test('the release workflow verifies the sealed bundle', () => {
  assert.match(wf, /release-evidence verify/, 'workflow must invoke the bundle verifier')
})

test('verification runs before the bundle is committed', () => {
  const verify = wf.indexOf('name: Verify the sealed bundle')
  const commit = wf.indexOf('name: Commit bundle to git')
  assert.ok(verify > 0, 'the verify step must exist')
  assert.ok(commit > 0, 'the commit step must still exist')
  assert.ok(verify < commit, 'verification must precede the commit, or it cannot block a bad bundle')
})

test('the verifier script is wired as a package script', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'packages', 'release-evidence', 'package.json'), 'utf8'))
  assert.equal(pkg.scripts?.verify, 'tsx scripts/verify-bundle.ts')
})
