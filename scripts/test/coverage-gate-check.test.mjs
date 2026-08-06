// HARNESS-09 guard: the CI Q1 job must run the unit suite WITH the coverage gate,
// and the gate itself must keep its >=80% thresholds. A workflow edit that quietly
// swaps `pnpm test:coverage` back to `pnpm test` (or a config edit that lowers the
// thresholds) re-opens the absent-control-looks-like-a-passing-one failure class
// this story closed — so both facts are asserted here, in a suite CI always runs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('Q1 runs the unit suite with the coverage gate (pnpm test:coverage)', () => {
  const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8')
  const q1 = ci.slice(ci.indexOf('q1-build-unit:'), ci.indexOf('q1b-test-integrity:'))
  assert.match(q1, /pnpm test:coverage/, 'Q1 must invoke pnpm test:coverage')
  assert.doesNotMatch(q1, /run: pnpm test\s*$/m, 'Q1 must not run the unit suite without coverage')
})

test('vitest coverage thresholds are present and >=80 on all four metrics', () => {
  const config = readFileSync(join(root, 'vitest.config.ts'), 'utf8')
  const m = config.match(
    /thresholds:\s*\{\s*statements:\s*(\d+),\s*branches:\s*(\d+),\s*functions:\s*(\d+),\s*lines:\s*(\d+)\s*\}/
  )
  assert.ok(m, 'vitest.config.ts must declare coverage thresholds for statements/branches/functions/lines')
  for (const [i, metric] of ['statements', 'branches', 'functions', 'lines'].entries()) {
    assert.ok(Number(m[i + 1]) >= 80, `${metric} threshold must be >=80 (found ${m[i + 1]})`)
  }
})
