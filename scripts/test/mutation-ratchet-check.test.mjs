// HARNESS-13 guards. Two controls that are easy to weaken with a one-character edit, and whose
// weakening leaves CI green — so they are asserted in a suite CI always runs.
//
//  1. The mutation `break` floor must stay AT OR ABOVE the measured baseline minus a small noise
//     margin. Lowering `break` to turn a red mutation run green is exactly the reward-hacking
//     Q1b/ADR 0019 exist to prevent, and nothing else in CI would notice.
//  2. The `workflow_dispatch` trigger must remain on ci.yml, and Q1b must keep REPORTING that it
//     cannot run on a dispatch rather than vanishing from the run — an omitted gate must never be
//     indistinguishable from a passing one (HARNESS-07).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// Measured 2026-08-06 over 493 mutants: 71.20% (vitest 2) / 70.99% (vitest 3). The floor is
// pinned just below the lower reading so ordinary noise cannot red the build, while any real
// decay does. Raise this constant together with stryker.config.json as survivors are killed.
const MEASURED_BASELINE = 70.99
const MAX_SLACK = 1.5

test('mutation break floor tracks the measured baseline (never lowered to force green)', () => {
  const cfg = JSON.parse(readFileSync(join(root, 'stryker.config.json'), 'utf8'))
  const brk = cfg.thresholds?.break
  assert.equal(typeof brk, 'number', 'stryker.config.json must set thresholds.break')
  assert.ok(
    brk >= MEASURED_BASELINE - MAX_SLACK,
    `break=${brk} is more than ${MAX_SLACK}pp below the measured baseline ${MEASURED_BASELINE} — ` +
      'the gate would tolerate real decay. Kill survivors and raise it, do not lower it.'
  )
  assert.ok(brk <= MEASURED_BASELINE, `break=${brk} exceeds the measured baseline ${MEASURED_BASELINE} — CI would be red on a clean tree`)
})

test('ci.yml keeps the on-demand full-matrix trigger', () => {
  const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8')
  const triggers = ci.slice(0, ci.indexOf('jobs:'))
  assert.match(triggers, /workflow_dispatch:/, 'ci.yml must keep the workflow_dispatch trigger')
})

test('Q1b reports it cannot run on a dispatch instead of silently disappearing', () => {
  const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8')
  const q1b = ci.slice(ci.indexOf('q1b-test-integrity:'), ci.indexOf('discovery-gates:'))
  assert.match(
    q1b,
    /workflow_dispatch/,
    'the Q1b job must still RUN on a dispatch (so its check-run exists) rather than being filtered out'
  )
  assert.match(q1b, /NOT RUN/, 'Q1b must explicitly announce that it did not execute on a dispatch')
  assert.match(q1b, /node scripts\/test-integrity\.mjs/, 'Q1b must still execute the integrity check on pull requests')
})
