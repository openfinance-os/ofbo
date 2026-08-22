// HARNESS-21 — the AI-review workflow-parity guard must judge what the PR CHANGED, not what
// merely DIFFERS from main's tip.
//
// The guard exists for a real reason and is not weakened here: `on: pull_request` hands secrets
// to same-repo PRs while running the workflow FROM THE PR HEAD, so a PR must not be able to
// rewrite the reviewer and collect its credential in the same run. That intent is preserved
// exactly — a PR that genuinely touches the control plane is still refused a review.
//
// What was wrong was the comparison. The guard ran:
//
//     git diff --name-only "origin/${DEFAULT_REF}" HEAD -- "${control_plane[@]}"
//
// a TWO-DOT diff, which compares main's tip against the PR head and answers "do these files
// differ?". The question the guard needs answered is "did this PR change them?", which is the
// THREE-DOT form, diffing against the merge base.
//
// The difference is not academic. Observed 2026-08-22 on PR #323: HARNESS-20 merged to main and
// edited ai-review.yml; twenty minutes later #323 — which modifies no control-plane file at all —
// had both of its reviewer legs skipped, each posting
//
//     "this PR modifies the review control plane (.github/workflows/ai-review.yml)"
//
// which was simply false. Two-dot flagged the file; three-dot was empty. Any PR that falls behind
// main on a control-plane file is silently denied its review, for a stated reason that does not
// describe it, and increasingly often as main moves. The remedy the message offers is wrong too:
// "this resolves once the PR merges" holds for a genuine modification, but a stale PR resolves by
// merging main IN — the opposite direction.
//
// This is the absent-control-looks-like-a-passing-one class (HARNESS-07) with an extra twist: the
// skip is non-fatal, so the check renders GREEN while the comment says "this is not a pass".
//
// The first test pins the form. The other two execute the guard's OWN command, lifted verbatim
// from the workflow, against synthetic repositories — so they bind its behaviour rather than its
// spelling, and would still catch a rewrite that changed the wording but kept the wrong semantics.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const workflow = readFileSync(join(root, '.github', 'workflows', 'ai-review.yml'), 'utf8')

const CONTROL_FILE = '.github/workflows/ai-review.yml'

/** The parity diff, lifted verbatim from the workflow so the tests cannot drift from it. */
function parityCommand() {
  const m = workflow.match(/^[ \t]*changed="\$\((git diff --name-only .*)\)"[ \t]*$/m)
  assert.ok(m, 'could not find the parity diff command (changed="$(git diff --name-only ...)") '
    + 'in .github/workflows/ai-review.yml — if it was renamed, update this guard deliberately')
  return m[1]
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

/**
 * Build a repo where `main` and a feature branch diverge, then run the guard's own command on the
 * feature branch. `touchOnBranch` decides whether the branch itself edits the control-plane file.
 * `main` always moves on that file, which is the staleness the old form could not distinguish.
 */
function runGuard({ touchOnBranch }) {
  const dir = mkdtempSync(join(tmpdir(), 'parity-'))
  try {
    git(dir, 'init', '--initial-branch=main', '--quiet')
    git(dir, 'config', 'user.email', 'guard@example.invalid')
    git(dir, 'config', 'user.name', 'guard')
    mkdirSync(join(dir, dirname(CONTROL_FILE)), { recursive: true })
    writeFileSync(join(dir, CONTROL_FILE), 'name: ai-review\n# base\n')
    writeFileSync(join(dir, 'src.ts'), 'export const a = 1\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-qm', 'base')

    git(dir, 'checkout', '-q', '-b', 'feature')
    // Every PR changes something; only some change the control plane.
    writeFileSync(join(dir, 'src.ts'), 'export const a = 2\n')
    if (touchOnBranch) {
      writeFileSync(join(dir, CONTROL_FILE), 'name: ai-review\n# base\n# edited by the PR\n')
    }
    git(dir, 'add', '-A')
    git(dir, 'commit', '-qm', 'feature work')

    // main moves on the control-plane file AFTER the branch forked — the HARNESS-20 situation.
    git(dir, 'checkout', '-q', 'main')
    writeFileSync(join(dir, CONTROL_FILE), 'name: ai-review\n# base\n# HARNESS-20 edit on main\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-qm', 'main moves on the control plane')

    // The workflow resolves origin/<default> as a remote-tracking ref; mirror that locally.
    git(dir, 'update-ref', 'refs/remotes/origin/main', git(dir, 'rev-parse', 'main'))
    git(dir, 'checkout', '-q', 'feature')

    const script = [
      'set -uo pipefail',
      'DEFAULT_REF=main',
      `control_plane=('${CONTROL_FILE}')`,
      `changed="$(${parityCommand()})"`,
      'printf "%s" "$changed"',
    ].join('\n')
    writeFileSync(join(dir, 'probe.sh'), script)
    return execFileSync('bash', ['probe.sh'], { cwd: dir, encoding: 'utf8' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the parity guard diffs against the merge base, not main\'s tip', () => {
  const cmd = parityCommand()
  assert.match(
    cmd, /\.\.\.HEAD/,
    'the parity diff must use the three-dot form (origin/${DEFAULT_REF}...HEAD) so it reports only '
    + `what THIS PR changed. Found: ${cmd}`
  )
  assert.doesNotMatch(
    cmd, /"origin\/\$\{DEFAULT_REF\}"[ \t]+HEAD/,
    'the two-dot form compares main\'s tip against the PR head, so a PR that is merely BEHIND main '
    + `on a control-plane file is misreported as having modified it. Found: ${cmd}`
  )
})

test('a PR merely BEHIND main on a control-plane file is not flagged', () => {
  assert.equal(
    runGuard({ touchOnBranch: false }), '',
    'main moved on the control plane after this branch forked and the branch touched none of it, '
    + 'so the guard must report nothing changed. Flagging here denies a review to every PR that '
    + 'falls behind main, and tells its author it "modifies the review control plane" when it does not'
  )
})

test('a PR that genuinely MODIFIES a control-plane file is still flagged', () => {
  // The anti-vacuous-pass half: a guard that reports nothing is trivially "correct" on the test
  // above. This is the case the guard exists for, and narrowing to three-dot must not lose it.
  assert.equal(
    runGuard({ touchOnBranch: true }), CONTROL_FILE,
    'a PR editing the review control plane must still be refused a review — `on: pull_request` '
    + 'runs the workflow from the PR head with the credential in scope'
  )
})
