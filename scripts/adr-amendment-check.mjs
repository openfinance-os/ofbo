// ADR 0030 — amending an accepted ADR. Enforces the convention that ADR records the decision
// for: in-place edits are allowed for statements of FACT, supersession is required for changes
// of DECISION, and either way the change is recorded on the document's face.
//
// WHY THIS IS A GATE AND NOT A NOTE IN A PROCESS DOC. The convention existed informally and did
// not hold. ADR 0007 was accepted on 2026-08-17 and substantively corrected the same day (65
// insertions, 22 deletions — VAT posture, query window, collection mechanics) with nothing on
// the document saying so; only `git log` knew. Nobody read a process doc before doing it,
// because nobody reads a process doc before editing a file. A check states the rule at the one
// moment somebody wants to know it: when they have just broken it.
//
// THE RULE. A pull request that MODIFIES an ADR whose status ON THE BASE BRANCH is `Accepted`
// must do one of:
//   1. add a dated amendment row to that ADR — a table row whose first cell is an ISO date; or
//   2. change that ADR's status to `Superseded` (the ADR 0012 -> 0016 route, for a decision
//      that actually changed rather than a fact that turned out wrong).
//
// DELIBERATELY NOT IN SCOPE, because a gate that guesses is worse than one that is slightly
// heavy: distinguishing a substantive correction from a typo. Any modification needs a row.
// ADR 0030's consequences record the proportionate relaxation if that proves noisy.
//
// EXEMPT: ADRs ADDED by this branch (nothing has been relied on yet) and ADRs whose base status
// is `Proposed` (drafts). The rule attaches at acceptance.
//
// Run from the repo root: `node scripts/adr-amendment-check.mjs` (exit 1 on a violation).
import { execFileSync } from 'node:child_process'
import process from 'node:process'

const ADR_DIR = 'docs/adrs'
const ADR_RE = /^(\d{4})-.+\.md$/

export const isAdrPath = (path) => ADR_RE.test(path.split('/').pop() ?? '')

/** First `Status:` line of an ADR body, lowercased; '' when the doc has none. */
export const statusOf = (text) => {
  const line = text.split('\n').find((l) => /^\s*-?\s*Status:/i.test(l))
  return (line ?? '').toLowerCase()
}

export const isAccepted = (text) => /\baccepted\b/.test(statusOf(text))
export const isSuperseded = (text) => /\bsuperseded\b/.test(statusOf(text))

/**
 * A dated amendment row: a markdown table row whose first cell is an ISO date.
 * Matched against ADDED lines only, so an existing table does not satisfy a new edit.
 */
export const AMENDMENT_ROW = /^\s*\|\s*\d{4}-\d{2}-\d{2}\s*\|/

export const addsAmendmentRow = (addedLines) => addedLines.some((l) => AMENDMENT_ROW.test(l))

/**
 * The pure rule, extracted so it is testable without git.
 *
 * @param changes one per modified ADR:
 *        { path, baseText, headText, addedLines }
 * @returns violations — one per ADR that was modified without being recorded
 */
export const violations = (changes) => {
  const found = []
  for (const c of changes) {
    if (!isAccepted(c.baseText)) continue // added, or Proposed on base — exempt
    if (isSuperseded(c.headText)) continue // route 2: a decision changed, superseded properly
    if (addsAmendmentRow(c.addedLines)) continue // route 1: recorded on the document's face
    found.push(c.path)
  }
  return found
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const tryGit = (args) => {
  try {
    return git(args)
  } catch {
    return null
  }
}

/** Resolve the base ref, fetching it if this is a shallow CI checkout. Mirrors Q2c's resolver. */
const resolveBase = () => {
  const branch = process.env.ADR_BASE_REF || process.env.GITHUB_BASE_REF || 'main'
  for (const ref of [`origin/${branch}`, branch]) {
    if (tryGit(['rev-parse', '--verify', `${ref}^{commit}`])) return ref
  }
  if (tryGit(['fetch', '--no-tags', '--depth=1', 'origin', branch]) !== null) {
    if (tryGit(['rev-parse', '--verify', 'FETCH_HEAD^{commit}'])) return 'FETCH_HEAD'
  }
  return null
}

/**
 * ADRs this branch changes relative to base, as { path, basePath }.
 *
 * RENAMES ARE INCLUDED DELIBERATELY. The first revision filtered on status `M` exactly, which
 * meant renaming an accepted ADR while editing it (git reports `R100`/`R087`, never `M`) walked
 * straight past the gate — the cheapest possible bypass of the rule this check exists to
 * enforce. Found by the hard-stop reviewer on PR #324, which reproduced it in a scratch repo.
 * For a rename the status line carries THREE fields, and the base text must be read from the
 * OLD path, because the new one does not exist on base.
 *
 * `A` (added) stays exempt: nothing has been relied on yet. `D` (deleted) is out of scope —
 * removing an accepted ADR outright is a different question from amending one, and ADR 0030
 * states a rule about modification. Recorded so the omission is a decision, not an oversight.
 */
export const parseNameStatus = (raw) =>
  raw
    .split('\n')
    .map((l) => l.split('\t'))
    .flatMap(([status, a, b]) => {
      if (!status) return []
      if (status === 'M' && a && isAdrPath(a)) return [{ path: a, basePath: a }]
      // R100 / R087 / C075 — the new path is the third field, the old one the second.
      if (/^[RC]\d*$/.test(status) && b && isAdrPath(b)) return [{ path: b, basePath: a }]
      return []
    })

const changedAdrs = (base) =>
  parseNameStatus(tryGit(['diff', '--name-status', `${base}...HEAD`, '--', `${ADR_DIR}/`]) ?? '')

const addedLinesFor = (base, path) =>
  (tryGit(['diff', '--unified=0', `${base}...HEAD`, '--', path]) ?? '')
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1))

const main = () => {
  const base = resolveBase()
  if (base === null) {
    // A merge gate must not flake on checkout shape; Q2c takes the same posture.
    process.stdout.write('adr-amendment-check: base ref unavailable — SKIPPED (not a pull-request run)\n')
    return
  }
  const paths = changedAdrs(base)
  if (paths.length === 0) {
    process.stdout.write('adr-amendment-check: no accepted ADR modified — nothing to check\n')
    return
  }
  const changes = paths.map(({ path, basePath }) => ({
    path,
    baseText: tryGit(['show', `${base}:${basePath}`]) ?? '',
    headText: tryGit(['show', `HEAD:${path}`]) ?? '',
    addedLines: addedLinesFor(base, path),
  }))
  const bad = violations(changes)
  if (bad.length === 0) {
    process.stdout.write(
      `adr-amendment-check: ${paths.length} ADR(s) modified, each recorded or superseded — OK\n`,
    )
    return
  }
  process.stderr.write('adr-amendment-check: accepted ADR modified without recording the amendment\n\n')
  for (const p of bad) process.stderr.write(`  ${p}\n`)
  process.stderr.write(`
ADR 0030: an ADR that is Accepted on the base branch may be edited in place for statements of
FACT, but the edit must be recorded on the document's face. Add a section:

    ### Amendments after acceptance

    | date | amendment |
    | --- | --- |
    | YYYY-MM-DD | what became untrue, and what replaced it |

Say what changed — "updated for accuracy" is not a row. A reader must be able to tell from the
table alone whether the thing they are relying on is one of the things that moved.

If the DECISION changed rather than a fact, this is the wrong route: supersede it with a new
ADR and set this one's status to Superseded (see ADR 0012 -> ADR 0016).\n`)
  process.exitCode = 1
}

if (process.argv[1] && process.argv[1].endsWith('adr-amendment-check.mjs')) {
  main()
}
