// Anti-reward-hacking gate (CI Q1b — "test integrity"). The spec-first loop commits
// contract/acceptance tests RED, then drives the code to green. The cheap cheat is to make
// the bar green by WEAKENING the test instead of fixing the code — skipping it, narrowing an
// assertion, or deleting expectations. Frontier coding agents are documented to do this
// (Anthropic reward-hacking research; independent agent-benchmark cheating audits, 2025).
//
// This is the deterministic, merge-blocking control of record (the local .claude
// test-tripwire hook is the first, advisory layer). It diffs the PR against its merge base
// and FAILS when, in the same change set:
//   (a) a test file gains a test-disabling marker (it.skip/.only/.todo/.fails/xit), OR
//   (b) a test file has a NET LOSS of assertions while non-test (implementation) files also
//       change — i.e. assertions were removed alongside the code they were meant to pin down.
//
// Pure deterministic text analysis: no model judgement, nothing to talk around. Exempt
// branches: *-testfix-* (a sanctioned test repair) and *-spec-* (a spec change legitimately
// reshapes the contract tests). Run from the repo root in CI; needs full history (fetch-depth: 0).
import { execFileSync } from 'node:child_process'
import process from 'node:process'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' })

const branch = (process.env.GITHUB_HEAD_REF || git('rev-parse', '--abbrev-ref', 'HEAD')).trim()
if (/-testfix-|-spec-/.test(branch)) {
  process.stdout.write(`test-integrity: branch '${branch}' is an exempt test-fix/spec branch — skipping.\n`)
  process.exit(0)
}

// Merge base against the PR target (GITHUB_BASE_REF in Actions) or origin/main locally.
const baseRef = process.env.GITHUB_BASE_REF
  ? `origin/${process.env.GITHUB_BASE_REF}`
  : process.env.BASE_REF || 'origin/main'
let base
try {
  base = git('merge-base', baseRef, 'HEAD').trim()
} catch {
  process.stdout.write(`test-integrity: cannot resolve merge base against ${baseRef} (shallow clone?) — skipping.\n`)
  process.exit(0)
}

const isTestFile = (f) => /\.spec\.tsx?$|\.e2e\.ts$|(^|\/)tests?\//.test(f)
const DISABLER = /\b(it|test|describe)\.(skip|only|todo)\b|\b(it|test)\.fails\b|\b(xit|xdescribe)\(/
const ASSERTION = /\bexpect\(|\bassert\b/

// Files changed in this PR, split into test vs implementation.
const changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean)
const testFiles = changed.filter(isTestFile)
const implFiles = changed.filter((f) => !isTestFile(f) && /\.(ts|tsx|mjs|js)$/.test(f))

if (testFiles.length === 0) {
  process.stdout.write('test-integrity: no test files changed — nothing to check.\n')
  process.exit(0)
}

const failures = []
for (const file of testFiles) {
  const patch = git('diff', `${base}...HEAD`, '--', file)
  let addedDisabler = null
  let assertDelta = 0 // added assertions minus removed
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) {
      if (!addedDisabler && DISABLER.test(line)) addedDisabler = line.slice(1).trim()
      if (ASSERTION.test(line)) assertDelta += 1
    } else if (line.startsWith('-')) {
      if (ASSERTION.test(line)) assertDelta -= 1
    }
  }
  if (addedDisabler) {
    failures.push(`${file}: introduces a test-disabling marker → \`${addedDisabler}\``)
  }
  // Net assertion loss is only suspicious when the implementation also moved in the same PR —
  // a pure test refactor that happens to consolidate assertions is allowed on its own.
  if (assertDelta < 0 && implFiles.length > 0) {
    failures.push(
      `${file}: net loss of ${-assertDelta} assertion(s) while implementation files changed ` +
        `(${implFiles.length} impl file(s)) — assertions removed alongside the code they pin.`
    )
  }
}

if (failures.length > 0) {
  process.stderr.write('\nQ1b test-integrity gate FAILED — tests were weakened, not satisfied:\n')
  for (const f of failures) process.stderr.write(`  ✗ ${f}\n`)
  process.stderr.write(
    '\nDrive the red tests green by fixing the CODE. If a test is genuinely wrong, repair it in the\n' +
      'open on a test-fix branch: feature/BACKOFFICE-NN-testfix-<slug> (this gate exempts *-testfix-* and *-spec-*).\n'
  )
  process.exit(1)
}

process.stdout.write(`test-integrity: ${testFiles.length} changed test file(s) inspected — no weakening detected.\n`)
process.exit(0)
