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
//   1. add a NEW dated amendment row under the `Amendments after acceptance` heading — a table
//      row whose first cell is an ISO date that the base version did not already carry; or
//   2. change that ADR's status to `Superseded` (the ADR 0012 -> 0016 route, for a decision
//      that actually changed rather than a fact that turned out wrong).
//
// DELIBERATELY NOT IN SCOPE, because a gate that guesses is worse than one that is slightly
// heavy: distinguishing a substantive correction from a typo. Any modification needs a row.
// ADR 0030's consequences record the proportionate relaxation if that proves noisy.
//
// EXEMPT: ADRs ADDED by this branch (nothing has been relied on yet) and ADRs whose base status
// is `Proposed` (drafts). The rule attaches at acceptance. Outright DELETION of an accepted ADR
// is also out of scope by ADR 0030's stated decision (doc-link-check already blocks orphaning a
// referenced ADR); the D+A same-number rewrite below is caught because it is a modification
// wearing a deletion's clothes, not a genuine removal.
//
// HARDENED after the hard-stop reviewer's FAIL(7) on PR #324 (each finding reproduced):
//   1  statusOf missed the `- **Status:**` (bold) form — broadened.
//   6  isAccepted/isSuperseded matched a word anywhere on the line — now anchored to the status
//      VALUE (the token after the colon), so ADR 0012's "Superseded by … was Accepted" line
//      classifies as superseded, not accepted.
//   2+5 row detection is now section-aware and set-based: compare the dated rows UNDER the
//      `Amendments after acceptance` heading (code fences stripped) in base vs head. A carried-
//      over row is in both sets → not new; a row inside a fence or a foreign table is ignored.
//      This also retires `addedLinesFor`, whose new-path-only diff suppressed rename detection.
//   3  a delete + re-add of the same ADR number (rename below git's similarity threshold) is a
//      modification, not a deletion — parseNameStatus pairs a `D` and an `A` on the same number.
//   7  a git failure AFTER the base resolved is an environment fault, not "clean": the
//      post-resolution calls use mustGit and throw (red), distinct from the intended SKIPPED.
//
// KNOWN LIMITS, recorded rather than coded — raised by the same review as out-of-scope notes:
//   * The route-2 exemption trusts the status line: flipping an ADR's status to `Superseded`
//     exempts it without checking that a superseding ADR actually exists. Not coded because
//     verifying "some other ADR supersedes this one" is a prose-parsing problem that would
//     false-red, and because writing `Superseded` into a status line is a visible, reviewable
//     lie sitting in the diff a human reads. The cheap bypass costs an obvious falsehood.
//   * This step shares the q2c check-run with the ADR-number reservation, so a red here is not
//     distinguishable from a red there on the checks tab — a mild HARNESS-07 tension. Kept
//     in-job anyway: a new check-run name strands branch-protection rules pinned to the current
//     ones, which is the worse failure. The step name and the stderr block name which fired.
//
// Run from the repo root: `node scripts/adr-amendment-check.mjs` (exit 1 on a violation).
import { execFileSync } from 'node:child_process'
import process from 'node:process'

const ADR_DIR = 'docs/adrs'
const ADR_RE = /^(\d{4})-.+\.md$/

export const isAdrPath = (path) => ADR_RE.test(path.split('/').pop() ?? '')

/** The 4-digit ADR number from a path — `docs/adrs/0007-foo.md` → `'0007'`; null if not an ADR. */
export const adrNumber = (path) => path.split('/').pop()?.match(ADR_RE)?.[1] ?? null

/**
 * The value of the first `Status:` line — the text AFTER the colon, emphasis stripped, lowered.
 * '' when the doc has no status line.
 *
 * Handles both forms in the tree: `- Status: **Accepted — Option 1**` and `- **Status:** Accepted`.
 * Anchoring on the value (not the whole line) is finding 6: ADR 0012's line
 * `- Status: **Superseded by ADR 0016** … was "Accepted — Option 1"` must read as superseded,
 * and `- Status: **Accepted** … (superseded the interim guidance)` must read as accepted.
 */
export const statusValue = (text) => {
  const line = text.split('\n').find((l) => /^\s*-?\s*\**\s*Status\s*\**\s*:/i.test(l))
  if (!line) return ''
  const afterColon = line.slice(line.indexOf(':') + 1)
  return afterColon.replace(/\*/g, '').trim().toLowerCase()
}

// Kept for back-compat with any external caller; now derived from statusValue.
export const statusOf = (text) => statusValue(text)

export const isAccepted = (text) => statusValue(text).startsWith('accepted')
export const isSuperseded = (text) => statusValue(text).startsWith('superseded')

/** A dated amendment-table row: first cell is an ISO date. */
export const AMENDMENT_ROW = /^\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|/

/** Remove fenced code blocks so an example row inside ``` cannot count as a real amendment. */
export const stripFences = (text) => text.replace(/```[\s\S]*?```/g, '')

/**
 * The set of dated rows under an `Amendments after acceptance` heading, each normalised to
 * `date|text` with runs of whitespace collapsed.
 *
 * Section-scoped (finding 5): rows elsewhere in the document, or inside a code fence, do not
 * count.
 *
 * COMPARED ON THE WHOLE ROW, NOT THE DATE. An earlier revision keyed the set on the ISO date
 * alone, which false-RED a compliant PR: a second genuine amendment made on the same calendar
 * day as an existing row read as "already there". ADR 0007 already carries two rows dated
 * 2026-08-17, so this was days from biting. A false red on compliant work is worse than most
 * bypasses — it blocks correct changes and teaches people the gate is noise. Caught by the
 * hard-stop reviewer as an out-of-scope robustness note on PR #324.
 */
export const amendmentRows = (text) => {
  const rows = new Set()
  let inSection = false
  for (const line of stripFences(text).split('\n')) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      inSection = /amendments after acceptance/i.test(heading[2])
      continue
    }
    if (!inSection) continue
    if (AMENDMENT_ROW.test(line)) {
      rows.add(line.trim().replace(/\s+/g, ' '))
    }
  }
  return rows
}

/** Route 1: the head carries a dated amendment row the base did not. */
export const hasNewAmendmentRow = (baseText, headText) => {
  const before = amendmentRows(baseText)
  for (const d of amendmentRows(headText)) {
    if (!before.has(d)) return true
  }
  return false
}

/**
 * The pure rule, extracted so it is testable without git.
 *
 * @param changes one per changed ADR: { path, baseText, headText }
 * @returns violations — one per accepted ADR modified without being recorded
 */
export const violations = (changes) => {
  const found = []
  for (const c of changes) {
    if (!isAccepted(c.baseText)) continue // added, or Proposed on base — exempt
    if (isSuperseded(c.headText)) continue // route 2: a decision changed, superseded properly
    if (hasNewAmendmentRow(c.baseText, c.headText)) continue // route 1: recorded on the face
    found.push(c.path)
  }
  return found
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
/** Soft: null on any git error. Used only for base-ref PROBING, where failure is expected. */
const tryGit = (args) => {
  try {
    return git(args)
  } catch {
    return null
  }
}
/** Hard: throws on git error. Used AFTER the base resolved, where a failure is anomalous
 * (finding 7) and must go red rather than read as "clean". */
const mustGit = (args) => git(args)

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
 * RENAMES (`R*`) and COPIES (`C*`) are included: those status lines carry THREE fields, and the
 * base text must be read from the OLD path (field 2) because the new one does not exist on base.
 *
 * D+A SAME-NUMBER REWRITE (finding 3): deleting an accepted ADR and re-adding a rewritten copy
 * under a new filename below git's rename-similarity threshold reports a separate `D` and `A`.
 * Neither is `M`/`R`/`C`, so both were dropped and a full rewrite passed as "nothing to check".
 * We pair a deleted ADR number with an added one and treat it as a modification of that number —
 * base text from the deleted path (still present on base). Duplicate ADR numbers are otherwise
 * forbidden (Q2b/Q2c), so a D+A collision always means "same ADR, rewritten", never two records.
 *
 * A plain `A` (new ADR, no matching delete) stays exempt; a plain `D` (outright deletion) is the
 * documented out-of-scope carve-out.
 */
export const parseNameStatus = (raw) => {
  const rows = raw
    .split('\n')
    .map((l) => l.split('\t'))
    .filter(([status]) => status)

  const direct = []
  const deletedByNum = new Map()
  const addedByNum = new Map()

  for (const [status, a, b] of rows) {
    if (status === 'M' && a && isAdrPath(a)) {
      direct.push({ path: a, basePath: a })
    } else if (/^[RC]\d*$/.test(status) && b && isAdrPath(b)) {
      // R100 / R087 / C075 — new path is field 3, old path field 2.
      direct.push({ path: b, basePath: a })
    } else if (status === 'D' && a && isAdrPath(a)) {
      deletedByNum.set(adrNumber(a), a)
    } else if (status === 'A' && a && isAdrPath(a)) {
      addedByNum.set(adrNumber(a), a)
    }
  }

  const collisions = []
  for (const [num, addedPath] of addedByNum) {
    const deletedPath = deletedByNum.get(num)
    if (deletedPath) collisions.push({ path: addedPath, basePath: deletedPath })
  }
  return [...direct, ...collisions]
}

const changedAdrs = (base) =>
  parseNameStatus(mustGit(['diff', '--name-status', `${base}...HEAD`, '--', `${ADR_DIR}/`]))

const main = () => {
  const base = resolveBase()
  if (base === null) {
    // A merge gate must not flake on checkout shape; Q2c takes the same posture. This is the
    // ONLY soft-skip: past here, a git failure is a real fault and mustGit lets it go red.
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
    baseText: mustGit(['show', `${base}:${basePath}`]),
    headText: mustGit(['show', `HEAD:${path}`]),
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
FACT, but the edit must be recorded on the document's face. Add a NEW row under:

    ### Amendments after acceptance

    | date | amendment |
    | --- | --- |
    | YYYY-MM-DD | what became untrue, and what replaced it |

Say what changed — "updated for accuracy" is not a row. A reader must be able to tell from the
table alone whether the thing they are relying on is one of the things that moved. The row must
be NEW (a carried-over row does not count) and must sit under the Amendments heading, not inside
a code fence.

If the DECISION changed rather than a fact, this is the wrong route: supersede it with a new
ADR and set this one's status to Superseded (see ADR 0012 -> ADR 0016).\n`)
  process.exitCode = 1
}

if (process.argv[1] && process.argv[1].endsWith('adr-amendment-check.mjs')) {
  main()
}
