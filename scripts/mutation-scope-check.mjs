// HARNESS-20 — decide whether the ~25-minute mutation gate needs to run for THIS event.
//
// WHY THIS EXISTS AS A SCRIPT rather than inline shell in mutation.yml: it is the thing
// standing between a security-core change and its gate. A control that decides whether
// another control runs has to be testable in isolation, so the decision is a pure function
// (`decide`) with the git I/O pushed to the edges.
//
// THE RULE IT IMPLEMENTS. GitHub's `paths:` filter answers "is this BRANCH relevant?" —
// it is evaluated against the cumulative PR diff. It cannot answer "did THIS PUSH touch
// the security core?", and conflating the two is what produced both the HARNESS-18 cost
// problem (every push on a branch that once touched auth.ts re-ran the gate) and the
// HARNESS-18 coverage hole (dropping `synchronize` meant a push that FIRST introduced a
// security-core change fired nothing at all). This answers the second question only; the
// workflow's `paths:` still answers the first.
//
// IT FAILS OPEN, ALWAYS. Every branch that cannot positively establish "this push did not
// touch the security core" returns run: true. A cost control that skips a security gate
// when it is unsure is not a cost control.
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
// Imported rather than taken as a global: eslint.config.mjs grants `scripts/**/*.mjs` only
// `fetch`, on the stated grounds that these CLIs import their `node:` builtins explicitly.
// Same reason output goes through process.stdout.write rather than console.log — matching
// doc-link-check.mjs, adr-number-check.mjs and ai-review-matrix.mjs.
import process from 'node:process'

// Kept in step with the `paths:` list in .github/workflows/mutation.yml — the guard test
// asserts the two agree, so they cannot drift silently. Directory entries are git
// pathspecs, so 'services/bff/src/approvals' covers the `/**` form the workflow uses.
export const SECURITY_CORE = [
  'services/bff/src/rbac.ts',
  'services/bff/src/auth.ts',
  'services/bff/src/approvals',
  'services/bff/src/high-class-audit.ts',
  'services/bff/src/idempotency.ts',
  'stryker.config.json',
  'vitest.mutation.config.ts',
  '.github/workflows/mutation.yml',
]

/**
 * Pure decision. No git, no filesystem, no environment — so every branch below is
 * reachable from a test.
 *
 * @param action      github.event.action ('synchronize', 'opened', …; '' for non-PR events)
 * @param before      github.event.before  (pushed range base)
 * @param after       github.event.after   (pushed range head)
 * @param baseExists  whether `before` resolves in this checkout
 * @param changed     security-core files changed in before..after (null if not computed)
 * @returns {{run: boolean, reason: string, changed: string[]}}
 */
export function decide({ action, before, after, baseExists, changed }) {
  // Not a push to an open PR: `opened`, `ready_for_review`, `reopened`, schedule, dispatch.
  // The workflow's `paths:` filter has already established relevance against the whole PR
  // diff (or there is no PR at all), so the gate applies by construction.
  if (action !== 'synchronize') {
    return {
      run: true,
      reason: `Event \`${action || 'non-pull_request'}\` — relevance already established by the workflow's \`paths:\` filter against the whole PR diff.`,
      changed: [],
    }
  }
  if (!before || !after) {
    return {
      run: true,
      reason: 'Could not read the pushed range from the event payload — running the gate rather than guessing.',
      changed: [],
    }
  }
  if (!baseExists) {
    return {
      run: true,
      reason: `Base commit \`${before}\` is unreachable (force-push, or rewritten history) — running the gate rather than guessing.`,
      changed: [],
    }
  }
  if (changed === null) {
    return {
      run: true,
      reason: 'Could not diff the pushed range — running the gate rather than guessing.',
      changed: [],
    }
  }
  if (changed.length > 0) {
    return { run: true, reason: 'This push touched the security core.', changed }
  }
  return {
    run: false,
    reason: `This push (\`${before}..${after}\`) touched none of the security-core files.`,
    changed: [],
  }
}

function gitChanged(before, after) {
  try {
    const out = execFileSync(
      'git',
      ['diff', '--name-only', before, after, '--', ...SECURITY_CORE],
      { encoding: 'utf8' },
    )
    return out.split('\n').map((s) => s.trim()).filter(Boolean)
  } catch {
    return null // caller fails open
  }
}

function revExists(rev) {
  try {
    execFileSync('git', ['cat-file', '-e', `${rev}^{commit}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function main() {
  const action = process.env.EVENT_ACTION ?? ''
  const before = process.env.EVENT_BEFORE ?? ''
  const after = process.env.EVENT_AFTER ?? ''

  const baseExists = action === 'synchronize' && before ? revExists(before) : false
  const changed = action === 'synchronize' && before && after && baseExists
    ? gitChanged(before, after)
    : null

  const verdict = decide({ action, before, after, baseExists, changed })

  const out = process.env.GITHUB_OUTPUT
  if (out) appendFileSync(out, `run=${verdict.run}\n`)

  const lines = verdict.run
    ? ['### Mutation gate: WILL RUN', '', verdict.reason]
    : [
        '### Mutation gate: NOT RUN for this push',
        '',
        verdict.reason,
        '',
        'Files that would have triggered it:',
        '',
        ...SECURITY_CORE.map((f) => `- \`${f}\``),
        '',
        'This is **not a pass** and **not a weakened gate**. An earlier push on this branch did',
        'touch the security core — that is why the workflow started at all — and that push ran',
        'the gate. Re-run on demand with `workflow_dispatch`.',
      ]
  if (verdict.changed.length) {
    lines.push('', '```', ...verdict.changed, '```')
  }

  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) appendFileSync(summary, lines.join('\n') + '\n')

  if (!verdict.run) {
    process.stdout.write(
      `::notice title=Mutation gate NOT RUN::${verdict.reason} The gate is not applicable to this push — it is not a pass, and not a skip of a relevant check.\n`,
    )
  }
  process.stdout.write(`run=${verdict.run} — ${verdict.reason}\n`)
}

// Only run the CLI when invoked directly, so the test can import `decide` cleanly.
if (process.argv[1] && process.argv[1].endsWith('mutation-scope-check.mjs')) {
  main()
}
