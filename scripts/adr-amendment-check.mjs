// ADR 0031 — amending an accepted ADR. Enforces the convention that ADR records the decision
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
// ADR 0031's consequences record the proportionate relaxation if that proves noisy.
//
// EXEMPT: ADRs ADDED by this branch (nothing has been relied on yet) and ADRs whose base status
// is `Proposed` (drafts). The rule attaches at acceptance. Outright DELETION of an accepted ADR
// is also out of scope by ADR 0031's stated decision; the D+A rewrite below is caught because it
// is a modification wearing a deletion's clothes, not a genuine removal.
//
// CORRECTION (round 3): this header used to justify that carve-out by claiming doc-link-check
// "already blocks orphaning a referenced ADR". It does not. That check resolves FILE-PATH
// references, and no ADR is referenced by path in the set it scans — ADRs are cited by NUMBER.
// Deleting an accepted ADR is green on both gates and silent. ADR 0031 now records this, and
// whether deletion should require a record is an open question for that ADR's owner.
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
// HARDENED AGAIN after the reviewer's FAIL(4) on round 3 — all four reproduced, three closed here:
//   1  route 1 was satisfied by EDITING an existing row, not just adding one. Whole-row comparison
//      had closed a false-RED and opened its mirror false-GREEN. Now both directions must hold:
//      a row added AND every base row surviving unmodified (amendmentDelta).
//   2  the D+A rewrite pairing keyed on the ADR NUMBER, so rewriting AND renumbering escaped
//      entirely. Leftovers are now paired across numbers, deterministically.
//   3  the status allow-list dropped a git TYPECHANGE (`T`). Closed as a category, not a letter.
//   4  NOT a code defect — the deletion carve-out's stated justification was factually wrong. The
//      claim is corrected above and in ADR 0031; the decision it supported is now an open question
//      for the ADR's owner rather than something this script should quietly decide.
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

/**
 * Is this an ADR *as it lives on the base branch* — i.e. `docs/adrs/NNNN-*.md`?
 *
 * Both halves matter, and the directory half is deliberately explicit rather than implied by a
 * diff pathspec: scoping the git diff to `docs/adrs/` made moving an ADR OUT of the directory
 * look like a bare deletion (finding 2 on PR #324). The scope test now travels with the path.
 */
export const isAdrPath = (path) =>
  path.startsWith(`${ADR_DIR}/`) && ADR_RE.test(path.split('/').pop() ?? '')

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

/**
 * What happened to the amendment table between base and head, as whole normalised rows.
 *
 * ADDED alone is not enough to satisfy route 1, and that asymmetry is finding 1 of the third
 * review round. Comparing whole rows closed a false-RED (a same-day second amendment) but opened
 * the mirror false-GREEN: EDITING an existing row makes it absent from the base set, so it reads
 * as "new". Appending a single period to an old row while rewriting the decision therefore passed
 * — and the reproduction used a DECISION-SCOPE change, which ADR 0031 routes to supersession, so
 * the gate green-lit the one case the convention most wants caught.
 *
 * Neither end of that trade is safe on its own. Membership has to be judged in BOTH directions:
 * the base's rows must survive into head (nothing rewritten or dropped) AND head must carry a row
 * the base did not.
 */
export const amendmentDelta = (baseText, headText) => {
  const before = amendmentRows(baseText)
  const after = amendmentRows(headText)
  return {
    added: [...after].filter((r) => !before.has(r)),
    removed: [...before].filter((r) => !after.has(r)),
  }
}

/** Route 1: a NEW row, and no existing row rewritten or dropped. */
export const hasNewAmendmentRow = (baseText, headText) => {
  const { added, removed } = amendmentDelta(baseText, headText)
  return added.length > 0 && removed.length === 0
}

/** Why a given ADR fails, or null when it is fine. Distinct reasons get distinct guidance. */
export const violationFor = (c) => {
  if (!isAccepted(c.baseText)) return null // added, or Proposed on base — exempt
  if (isSuperseded(c.headText)) return null // route 2: a decision changed, superseded properly
  const { added, removed } = amendmentDelta(c.baseText, c.headText)
  // Checked BEFORE "no new row": a PR that rewrites an old row AND adds a new one is still
  // editing history, and saying "add a row" to someone who just added one reads as noise.
  if (removed.length > 0) return 'rewrote-or-removed-existing-row'
  if (added.length === 0) return 'no-new-row'
  return null
}

/**
 * The pure rule, extracted so it is testable without git.
 *
 * @param changes one per changed ADR: { path, baseText, headText }
 * @returns violations — `{ path, reason }` per accepted ADR modified without being recorded
 */
export const violations = (changes) =>
  changes.map((c) => ({ path: c.path, reason: violationFor(c) })).filter((v) => v.reason !== null)

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
    } else if (!/^([MRCDA]\d*)$/.test(status) && a && isAdrPath(a)) {
      // CATCH-ALL, and deliberately ahead of the specific branches for everything except `M`
      // (finding 3, round 3). The parser used to enumerate M/R/C/D/A and silently drop anything
      // else, so a git TYPECHANGE (`T` — e.g. replacing an accepted ADR with a symlink) reported
      // "nothing to check" and exited 0. Enumerating `T` alone would leave the same shape open for
      // the next letter (`U` unmerged, `X` unknown), so the allow-list is closed as a CATEGORY:
      // any status git invents that touches an ADR path is treated as a modification of it. The
      // reviewer rated the symlink case exotic and was unsure it was worth closing; closing the
      // class rather than the instance is what makes it worth doing once.
      direct.push({ path: a, basePath: a })
    } else if (/^[RC]\d*$/.test(status) && a && b && isAdrPath(a)) {
      // R100 / R087 / C075 — new path is field 3, old path field 2.
      //
      // SCOPED ON THE OLD PATH, NOT THE NEW ONE. Testing the destination let a rename OUT of
      // the ADR shape walk past the gate entirely: `0007-x.md` -> `adr-0007-x.md`, or a move to
      // `docs/0007-x.md`, both stopped matching and the whole change was dropped (findings 1
      // and 2 on PR #324, both reproduced). What makes a change in scope is that the thing
      // being edited WAS an accepted ADR on base — where the author moves it to is exactly the
      // freedom the bypass exploited.
      direct.push({ path: b, basePath: a })
    } else if (status === 'D' && a && isAdrPath(a)) {
      deletedByNum.set(adrNumber(a), a)
    } else if (status === 'A' && a && isAdrPath(a)) {
      addedByNum.set(adrNumber(a), a)
    }
  }

  // PASS 1 — pair a deleted and an added ADR carrying the SAME number. Unambiguous: duplicate
  // numbers are forbidden elsewhere (Q2b/Q2c), so this always means "same record, rewritten".
  const collisions = []
  const deletedLeft = new Map(deletedByNum)
  const addedLeft = new Map(addedByNum)
  for (const [num, addedPath] of addedByNum) {
    const deletedPath = deletedByNum.get(num)
    if (deletedPath) {
      collisions.push({ path: addedPath, basePath: deletedPath })
      deletedLeft.delete(num)
      addedLeft.delete(num)
    }
  }

  // PASS 2 — pair what is LEFT, across different numbers (finding 2, round 3). Keying the rewrite
  // detection on the ADR number meant that deleting accepted `0007-payables.md` and adding
  // `0031-payables-restated.md` produced no collision at all: `nothing to check`, exit 0. The
  // number is a label, not the record; renumbering while rewriting is the same evasion as renaming
  // while rewriting, which this script already refuses to honour ("where the author moves it to is
  // exactly the freedom the bypass exploited").
  //
  // ORDER IS DEFINED, NOT INCIDENTAL: both sides are sorted so the pairing is deterministic across
  // machines and git versions — a gate whose verdict depends on map iteration order is not a gate.
  //
  // THE FALSE-RED THIS CAN CAUSE, AND WHY IT IS ACCEPTED. A PR that genuinely deletes one ADR under
  // the carve-out AND separately adds an unrelated new ADR will pair them and demand a record. That
  // is a real cost, and it is bounded three ways: an accepted ADR is only exempt-deletable under a
  // carve-out whose stated justification turned out not to exist (see ADR 0031's amendment table);
  // a deletion paired against a NON-accepted base is dropped downstream by `isAccepted`, so only
  // accepted records can trigger it; and the remedy is cheap and obvious — split the PR, or record
  // the amendment. Silently exempting a rewrite is the worse failure.
  const deletedRest = [...deletedLeft.values()].sort()
  const addedRest = [...addedLeft.values()].sort()
  for (let i = 0; i < Math.min(deletedRest.length, addedRest.length); i++) {
    collisions.push({ path: addedRest[i], basePath: deletedRest[i] })
  }
  // Any deleted ADR with no added counterpart left over is a genuine removal — the documented
  // out-of-scope carve-out — and is intentionally not returned here.

  return [...direct, ...collisions]
}

/**
 * NO PATHSPEC, deliberately. Restricting the diff to `docs/adrs/` meant git reported a move OUT
 * of the directory as a bare `D` — indistinguishable from the documented deletion carve-out, so
 * rewrite-plus-relocate was exempt (finding 2 on PR #324, reproduced). Scoping now lives in
 * `isAdrPath`, which travels with the path and sees both ends of a rename. The whole-tree
 * name-status is cheap: one line per changed file, no content.
 */
const changedAdrs = (base) =>
  parseNameStatus(mustGit(['diff', '--name-status', `${base}...HEAD`]))

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
  for (const { path: p, reason } of bad) {
    const detail =
      reason === 'rewrote-or-removed-existing-row'
        ? 'an EXISTING amendment row was rewritten or removed'
        : 'no new amendment row'
    process.stderr.write(`  ${p} — ${detail}\n`)
  }
  process.stderr.write(`
ADR 0031: an ADR that is Accepted on the base branch may be edited in place for statements of
FACT, but the edit must be recorded on the document's face. Add a NEW row under:

    ### Amendments after acceptance

    | date | amendment |
    | --- | --- |
    | YYYY-MM-DD | what became untrue, and what replaced it |

Say what changed — "updated for accuracy" is not a row. A reader must be able to tell from the
table alone whether the thing they are relying on is one of the things that moved. The row must
be NEW (a carried-over row does not count) and must sit under the Amendments heading, not inside
a code fence.

ROWS ALREADY ON THE DOCUMENT ARE HISTORY: they must survive your edit unchanged. Rewriting an
existing row does not satisfy this rule — it is the thing the rule exists to prevent. If an old
row is itself wrong, restore it and add a NEW row saying so.

If the DECISION changed rather than a fact, this is the wrong route: supersede it with a new
ADR and set this one's status to Superseded (see ADR 0012 -> ADR 0016).\n`)
  process.exitCode = 1
}

if (process.argv[1] && process.argv[1].endsWith('adr-amendment-check.mjs')) {
  main()
}
