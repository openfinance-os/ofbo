// HARNESS-19 guards for the mutation-gate classifier.
//
// This script decides whether a security gate runs. Its failure mode is silent: a wrong
// `run: false` skips mutation testing on a security-core change and CI stays green, which is
// exactly the class HARNESS-18 fell into. So every branch is asserted here, and the three
// FAIL-OPEN branches are asserted individually — those are the ones that must never be
// "optimised" into a skip.
//
// The decision is a pure function precisely so this file can reach all of it without git.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { decide, SECURITY_CORE } from '../mutation-scope-check.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

// A push that genuinely touched the security core.
test('a push touching the security core runs the gate', () => {
  const v = decide({
    action: 'synchronize',
    before: SHA_A,
    after: SHA_B,
    baseExists: true,
    changed: ['services/bff/src/auth.ts'],
  })
  assert.equal(v.run, true)
  assert.deepEqual(v.changed, ['services/bff/src/auth.ts'])
})

// The ONLY branch that skips. If this ever returns true the cost fix is inert; if the
// surrounding branches ever return false, a gate is being skipped on uncertainty.
test('a push touching nothing in the security core skips the gate — the only skip', () => {
  const v = decide({
    action: 'synchronize',
    before: SHA_A,
    after: SHA_B,
    baseExists: true,
    changed: [],
  })
  assert.equal(v.run, false)
  assert.match(v.reason, /touched none of the security-core files/)
})

// --- FAIL-OPEN BRANCHES. Each must run the gate. ---------------------------------------
// These are the HARNESS-18 lesson in test form: when the classifier cannot establish that a
// push is irrelevant, the expensive-but-correct answer is the right one.

test('an unreachable base commit (force-push) runs the gate', () => {
  const v = decide({
    action: 'synchronize', before: SHA_A, after: SHA_B, baseExists: false, changed: null,
  })
  assert.equal(v.run, true, 'a force-pushed-away base must not silently skip the gate')
  assert.match(v.reason, /unreachable/)
})

test('a missing pushed range in the payload runs the gate', () => {
  for (const [before, after] of [['', SHA_B], [SHA_A, ''], ['', '']]) {
    const v = decide({ action: 'synchronize', before, after, baseExists: true, changed: null })
    assert.equal(v.run, true, `before=${before || '""'} after=${after || '""'} must run the gate`)
  }
})

test('a failed diff runs the gate', () => {
  const v = decide({
    action: 'synchronize', before: SHA_A, after: SHA_B, baseExists: true, changed: null,
  })
  assert.equal(v.run, true, 'an un-computable diff must not silently skip the gate')
})

// --- NON-SYNCHRONIZE EVENTS ------------------------------------------------------------
// These are the events whose relevance GitHub's `paths:` filter already established against
// the whole PR diff. They must always run — this is the half that closes the HARNESS-18
// coverage hole from the other side.

test('every non-synchronize event runs the gate', () => {
  for (const action of ['opened', 'ready_for_review', 'reopened', '']) {
    const v = decide({ action, before: '', after: '', baseExists: false, changed: null })
    assert.equal(v.run, true, `action "${action}" must run the gate`)
  }
})

// --- DRIFT GUARD -----------------------------------------------------------------------
// The script's list and the workflow's `paths:` list are two copies of the same fact. If
// they drift, the classifier can skip a file the workflow considers security-core (or the
// reverse), and nothing else would notice.

test('the script and the workflow agree on what the security core is', () => {
  const wf = readFileSync(join(root, '.github', 'workflows', 'mutation.yml'), 'utf8')
  const pathsBlock = wf.slice(wf.indexOf('    paths:'), wf.indexOf('concurrency:'))
  const workflowPaths = [...pathsBlock.matchAll(/^\s+- '([^']+)'/gm)].map((m) => m[1])

  assert.ok(workflowPaths.length > 0, 'could not parse the workflow paths: list')

  // The workflow uses glob form ('…/approvals/**'); the script uses git pathspec form
  // ('…/approvals'). Normalise the glob suffix before comparing.
  const normalise = (p) => p.replace(/\/\*\*$/, '')
  assert.deepEqual(
    [...workflowPaths.map(normalise)].sort(),
    [...SECURITY_CORE].sort(),
    'mutation.yml paths: and SECURITY_CORE in scripts/mutation-scope-check.mjs have drifted — ' +
      'the classifier would then disagree with the trigger about what counts as the security core',
  )
})

// --- WIRING ----------------------------------------------------------------------------
// The classifier is worthless if the expensive job does not actually depend on it.

test('the mutation job is gated on the classifier', () => {
  const wf = readFileSync(join(root, '.github', 'workflows', 'mutation.yml'), 'utf8')
  const job = wf.slice(wf.indexOf('  mutation:'))
  assert.match(job, /needs:\s*changes/, 'the mutation job must depend on the changes job')
  assert.match(
    job,
    /if:\s*\$\{\{\s*needs\.changes\.outputs\.run\s*==\s*'true'\s*\}\}/,
    'the mutation job must run only when the classifier says so',
  )
})
