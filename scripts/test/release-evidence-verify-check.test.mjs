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

// `pnpm --filter` runs a script with cwd = packages/release-evidence, so any RELATIVE bundle
// path resolves under the package, not the repo root — while the commit step does
// `git add "releases/$TAG"` from the root. Both the write and the verify must therefore be
// anchored to $GITHUB_WORKSPACE, or the first release fails at `git add` (or, worse, verifies
// a different file from the one committed).
test('the bundle write and the verification are anchored to the workspace, not the package cwd', () => {
  const build = wf.slice(wf.indexOf('name: Build + write evidence bundle'), wf.indexOf('name: Verify the sealed bundle'))
  assert.match(build, /--out "\$GITHUB_WORKSPACE\/releases"/, 'the bundle must be written to the workspace releases/ dir')

  const verify = wf.slice(wf.indexOf('name: Verify the sealed bundle'), wf.indexOf('name: Commit bundle to git'))
  assert.match(verify, /\$GITHUB_WORKSPACE\/releases\//, 'the verifier must be pointed at the same workspace path')
})

test('the verifier script is wired as a package script', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'packages', 'release-evidence', 'package.json'), 'utf8'))
  assert.equal(pkg.scripts?.verify, 'tsx scripts/verify-bundle.ts')
})
