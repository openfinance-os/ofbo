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

for (const file of ['mutation.yml', 'ai-review.yml']) {
  test(`${file} does not re-run on every push (pull_request types exclude synchronize)`, () => {
    const types = prTypes(workflow(file))
    assert.ok(
      types !== null,
      `${file} must list pull_request \`types:\` explicitly. Omitting it means GitHub's default ` +
        '(opened, synchronize, reopened), and `synchronize` fires on EVERY push to the branch.'
    )
    assert.ok(
      !types.includes('synchronize'),
      `${file} lists \`synchronize\`, so it re-runs on every push to a PR branch. That is the ` +
        'exact regression HARNESS-18 removed — mutation burned 215 runner-minutes in two days on ' +
        'runs the concurrency group then cancelled, and ai-review paid ~12 runner-minutes plus ' +
        'two model calls per intermediate commit.'
    )
  })

  test(`${file} still reviews the state a human is asked to merge`, () => {
    const types = prTypes(workflow(file))
    // Dropping `synchronize` is only defensible if these two remain: `opened` catches the PR
    // (drafts included), `ready_for_review` catches the final state. Losing either would turn a
    // cost fix into a coverage cut.
    for (const t of ['opened', 'ready_for_review']) {
      assert.ok(types.includes(t), `${file} must keep the \`${t}\` trigger — without it, dropping \`synchronize\` would reduce coverage rather than cost`)
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

test('mutation.yml keeps the triggers that make dropping synchronize affordable', () => {
  const block = triggers(workflow('mutation.yml'))
  // The weekly schedule is what still exercises the security core independently of anyone
  // opening a PR, and workflow_dispatch is the documented escape hatch (it accepts any ref,
  // which is why mutation needs no label trigger).
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
