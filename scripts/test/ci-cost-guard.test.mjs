// HARNESS-18 guards. Two runner-cost controls that a one-word edit silently reverses, and whose
// reversal leaves CI GREEN — the failure mode is a bill, not a red check, so nothing else in the
// harness would ever notice. Asserted here, in a suite CI always runs (discovery-gates).
//
// The measurement that motivated them, 18-19 Aug 2026 (per-job wall time, each job billed rounded
// up to the whole minute):
//
//   workflow    jobs/run   billable min/run   runs/2d   ~billable min
//   ci              10           22             60          ~870
//   mutation         1           25 (10-14
//                                 when cancelled)  30          ~380
//   ai-review        3           12             30          ~220
//   deploy           5            9              ~4           ~36
//                                                          ~1,500 / 2 days
//
// Both guards below are about TRIGGER BREADTH, not about the gates themselves. Neither weakens a
// check: mutation still runs on every security-core PR, ai-review still reviews every PR. What is
// asserted is that neither re-runs on every intermediate push of a long agent-driven branch.
//
// If a future change genuinely needs `synchronize` back, change the constant AND the workflow
// comment together — do not delete the test. A cost control removed on purpose is a decision; one
// removed by accident is the reason this file exists.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const workflow = (name) => readFileSync(join(root, '.github', 'workflows', name), 'utf8')

// The trigger block only — everything before `jobs:`. Job-level `if:` expressions legitimately
// mention event names, and matching those would make these assertions meaningless.
const triggers = (text) => text.slice(0, text.indexOf('jobs:'))

// `types:` under the pull_request trigger. Absent means GitHub's default
// (opened, synchronize, reopened) — which is the expensive case, so absence must FAIL, not pass.
const prTypes = (text) => {
  const block = triggers(text)
  const m = block.match(/^\s*types:\s*\[([^\]]*)\]/m)
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : null
}

// HARNESS-19 SPLITS THE TWO WORKFLOWS, because they now control cost by different means and
// asserting one rule over both is what let the HARNESS-18 hole through.
//
//   mutation.yml  — DOES take `synchronize`. Cost is controlled by the `changes` classifier
//                   job, which decides on the PUSHED RANGE. Trigger breadth is deliberately
//                   NOT the lever here: narrowing it (HARNESS-18) meant a push that FIRST
//                   introduced a security-core change fired nothing at all.
//   ai-review.yml — does NOT take `synchronize`. It has no per-push classifier because the
//                   expensive part is the model call on the whole diff, which a classifier
//                   cannot make cheaper. The accepted cost is a verdict that reflects the head
//                   at open; the comment names its reviewed SHA so that is legible.
test('mutation.yml takes synchronize, and gates cost on the classifier rather than trigger breadth', () => {
  const types = prTypes(workflow('mutation.yml'))
  assert.ok(types !== null, 'mutation.yml must list pull_request `types:` explicitly')
  assert.ok(
    types.includes('synchronize'),
    'mutation.yml must keep `synchronize`. Without it, a PR opened non-draft that FIRST touches ' +
      'the security core in a later push fires nothing: `paths:` did not match at `opened`, and ' +
      '`ready_for_review` cannot fire for a PR that was never a draft. That PR then merges with ' +
      'its four-eyes / high-class-audit changes mutation-tested zero times. This is the ' +
      'HARNESS-18 regression; cost is controlled by the `changes` job instead.'
  )
})

test('ai-review.yml does not re-run its model calls on every push', () => {
  const types = prTypes(workflow('ai-review.yml'))
  assert.ok(types !== null, 'ai-review.yml must list pull_request `types:` explicitly')
  assert.ok(
    !types.includes('synchronize'),
    'ai-review.yml lists `synchronize`, so both reviewer legs re-read the entire diff on every ' +
      'push — ~12 runner-minutes plus two model calls per intermediate commit (24 runs in one ' +
      'day, 19 Aug 2026).'
  )
})

test('ai-review.yml states which commit it reviewed, so a stale verdict cannot read as current', () => {
  // The accepted cost of dropping `synchronize` is that the verdict lags the head. That is
  // only tolerable if the artifact says so — otherwise a ✅ written at open sits on the PR
  // looking current over every later push, which is the absent-control-looks-like-a-passing-one
  // class this workflow exists to close.
  const wf = workflow('ai-review.yml')
  assert.match(
    wf,
    /REVIEWED_SHA:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/,
    'the comment step must be given the reviewed PR head SHA (not github.sha, which is the ' +
      'ephemeral merge commit)'
  )
  assert.match(wf, /reviewedSha/, 'the comment body must render the reviewed SHA')
  assert.match(
    wf,
    /verdict is stale/,
    'the comment must tell the reader the verdict is stale if the PR has moved on'
  )
})

for (const file of ['mutation.yml', 'ai-review.yml']) {
  test(`${file} still covers the state a human is asked to merge`, () => {
    const types = prTypes(workflow(file))
    // `opened` catches the PR (drafts included), `ready_for_review` catches the final state.
    // Losing either turns a cost control into a coverage cut.
    for (const t of ['opened', 'ready_for_review']) {
      assert.ok(types.includes(t), `${file} must keep the \`${t}\` trigger`)
    }
  })

  test(`${file} still supersedes its own in-flight runs`, () => {
    // Without this, dropping `synchronize` still leaves rapid opened/reopened cycles stacking
    // full-price runs on one another.
    assert.match(
      workflow(file),
      /cancel-in-progress:\s*true/,
      `${file} must keep \`cancel-in-progress: true\``
    )
  })
}

test('mutation.yml keeps its schedule and on-demand paths', () => {
  const block = triggers(workflow('mutation.yml'))
  // The weekly schedule is what still exercises the security core independently of anyone
  // opening a PR — and it is the backstop that limited the blast radius of the HARNESS-18
  // hole to "caught on the following Monday" rather than "never". workflow_dispatch is the
  // documented escape hatch (it accepts any ref, which is why mutation needs no label trigger).
  assert.match(block, /schedule:/, 'mutation.yml must keep its weekly schedule')
  assert.match(block, /workflow_dispatch:/, 'mutation.yml must keep workflow_dispatch — it is the on-demand re-run path for a feature branch')
})

test('ai-review.yml keeps a label escape hatch, narrowed to one label', () => {
  const text = workflow('ai-review.yml')
  const types = prTypes(text)
  // ai-review deliberately has no workflow_dispatch (no merge base, nowhere to post), and
  // re-running from the Checks tab replays the original head SHA. The label is therefore the
  // ONLY way to re-review the current head after a push.
  assert.ok(
    types.includes('labeled'),
    'ai-review.yml must keep the `labeled` trigger — it is the only way to re-review the CURRENT ' +
      'head, since there is no workflow_dispatch and a Checks-tab re-run replays the original SHA'
  )
  // Unnarrowed, `labeled` would spend two model calls every time anyone adds any label at all.
  const config = text.slice(text.indexOf('  config:'), text.indexOf('  review:'))
  assert.match(
    config,
    /github\.event\.action != 'labeled'/,
    'the config job must let non-labeled events through unconditionally'
  )
  assert.match(
    config,
    /github\.event\.label\.name == 'ai-review'/,
    'the `labeled` trigger must be narrowed to the `ai-review` label, or every label costs two model calls'
  )
})
