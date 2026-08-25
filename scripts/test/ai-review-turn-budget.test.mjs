// HARNESS-22 — the AI reviewer's turn budget must be large enough to review a real PR.
//
// MEASURED 2026-08-22, across every ai-review leg that actually invoked an engine:
//
//   outcome             n    changed files    churn (added+deleted)
//   reviewed ok        16          5 – 10            16 – 1080
//   DID NOT COMPLETE    2             41                  1430
//
// Complete separation: no successful review above 10 changed files, no failure below 41. The
// failures are PR #325's two legs — 326s and 397s, valid credential (the preflight credential
// guard passed), engine step failed, no review file written.
//
// FILE COUNT SEPARATES; CHURN DOES NOT. PR #324 reviewed fine at 1080 churn across 6 files while
// #325 died at 41 files / 1430 churn. A context-window limit would track churn. A per-file
// TOOL-CALL budget tracks file count — which is what `--max-turns` is, and the reviewer must Read
// each changed file to report findings at file:line as its prompt requires.
//
// HONEST LIMITS OF THE EVIDENCE, because the fix is sized from it:
//   - Both failures are the same PR, so this is one independent observation, not two.
//   - The 10 → 41 file gap is unsampled; the true cliff is somewhere inside it, not known.
//   - The engine's own error text was never read: GitHub's job-log endpoint caps its response at
//     ~1.2 KB of tail and the full-log download is a blob-host redirect this environment cannot
//     follow. So the cause is correlation plus a mechanism that fits, NOT a quoted error.
//
// The floor asserted here is therefore deliberately not "the exact number needed" — nobody knows
// that. It is "materially above the value that demonstrably failed at 41 files", so the budget
// cannot silently drift back to a value already shown to be too small. A PR large enough will
// still exhaust any fixed budget; that residual is stated in the workflow comment rather than
// pretended away.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const workflow = readFileSync(join(root, '.github', 'workflows', 'ai-review.yml'), 'utf8')

/** The value that was in place when both legs of a 41-file PR failed to produce a review. */
const KNOWN_TOO_SMALL = 30
/** Headroom over the observed failure point, not a claim about the exact requirement. */
const FLOOR = 60

function maxTurns() {
  const m = workflow.match(/--max-turns\s+(\d+)/)
  return m ? Number(m[1]) : null
}

test('the reviewer declares a turn budget', () => {
  // Absent means the engine runs with the action's default, which is not pinned by this repo and
  // could change under us. A budget nobody states is a budget nobody controls.
  assert.notEqual(
    maxTurns(), null,
    'no --max-turns found in ai-review.yml. The budget must be explicit and reviewable here, '
    + 'because it is what decides whether a large PR gets reviewed at all'
  )
})

test('claude_args carries only flags — no comment lines smuggled into the CLI', () => {
  // Written because I made this mistake while fixing the budget. `claude_args: |` is a literal
  // block handed straight to the CLI, so a `#` line inside it becomes an ARGUMENT, not a comment.
  // The failure would be quiet in the worst way: the YAML still parses, this file's regex still
  // finds the right number, and the guard would report a budget that the engine never received.
  // Rationale for the value belongs in YAML comments outside the block.
  const m = workflow.match(/claude_args:\s*\|\s*\n((?:\s{12}.*\n)+)/)
  assert.ok(m, 'could not locate the claude_args literal block in ai-review.yml')
  const lines = m[1].split('\n').map((l) => l.trim()).filter(Boolean)
  const notFlags = lines.filter((l) => !l.startsWith('--'))
  assert.deepEqual(
    notFlags, [],
    'every line of claude_args is passed to the CLI as an argument, so each must be a flag. '
    + `These would be passed verbatim:\n  ${notFlags.join('\n  ')}`
  )
})

test('the turn budget is above the value that failed on a 41-file PR', () => {
  const n = maxTurns()
  assert.ok(
    n > KNOWN_TOO_SMALL,
    `--max-turns is ${n}, at or below ${KNOWN_TOO_SMALL} — the value in place when BOTH reviewer `
    + 'legs of PR #325 (41 changed files) ran for 326s and 397s and produced no review file'
  )
  assert.ok(
    n >= FLOOR,
    `--max-turns is ${n}, below the ${FLOOR} floor. Every observed successful review was a PR of `
    + '10 changed files or fewer; the failures were at 41. The floor keeps meaningful headroom '
    + 'over the demonstrated failure point'
  )
})
