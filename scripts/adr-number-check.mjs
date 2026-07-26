// HARNESS-06 — ADR number reservation. Extends the duplicate-ADR-number check that HARNESS-05
// (ADR 0020) added to Q2b, closing the race that check CANNOT see.
//
// Q2b's check is intra-tree: it fails when the CHECKED-OUT tree holds two ADRs sharing a NNNN
// prefix. That is necessary but not sufficient, because a collision is created by two branches
// that are each individually clean:
//
//   PR #294 adds 0027-multi-tenant-tenancy-model.md   → tree has one 0027 → Q2b green
//   PR #295 adds 0027-ozone-channel-si-distribution.md → tree has one 0027 → Q2b green
//   both merge → main has two 0027s → Q2b red ON MAIN, after the fact
//
// That is exactly what happened on 2026-07-22 (and, in the same shape, to ADR 0018 while PR #250
// was open). The number is only contended across branches, so the check has to look across
// branches too. Two checks, in increasing order of reach:
//
//   1. BASE  (no network) — a number this branch ADDS must not already exist on the base branch.
//      Catches the stale-branch case: main took your number while your PR sat open. This alone
//      would have failed #294 on any rebuild after #295 merged.
//   2. PEER  (GitHub API) — a number this branch adds must not also be claimed by an OPEN pull
//      request that was opened EARLIER. Catches the collision while both are still in flight,
//      which is the only point at which it is cheap to fix.
//
// Tie-break for (2) is first-opened-keeps-it: the LOWER pull-request number holds the claim, so
// exactly one side of a collision fails and the resolution is deterministic rather than a
// race between two red PRs. This mirrors how both real collisions were actually resolved.
//
// Failure posture: a genuine collision is a HARD fail (merge-blocking — that is the point). An
// API that is unreachable, rate-limited or unauthorized is a SOFT skip: a merge gate must not
// flake on GitHub availability, and check (1) still runs offline.
//
// Run from the repo root: `node scripts/adr-number-check.mjs` (exit 1 on a collision).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const ADR_DIR = 'docs/adrs'
const ADR_RE = /^(\d{4})-.+\.md$/

/** Number out of an ADR path — `docs/adrs/0027-foo.md` → `'0027'`; null if not an ADR. */
export const adrNumber = (path) => path.split('/').pop()?.match(ADR_RE)?.[1] ?? null

/**
 * The pure collision rule, extracted so it is testable without git or a network.
 *
 * @param mine  ADR paths this branch adds (path strings)
 * @param theirs ADR paths already claimed elsewhere, as { number, path, source }
 * @returns findings — one per contended number
 */
export const collisions = (mine, theirs) => {
  const claimed = new Map()
  for (const t of theirs) {
    if (!claimed.has(t.number)) claimed.set(t.number, [])
    claimed.get(t.number).push(t)
  }
  const findings = []
  for (const path of mine) {
    const num = adrNumber(path)
    if (num === null) continue
    for (const holder of claimed.get(num) ?? []) {
      // Same filename is the same record arriving by another route (e.g. already on base
      // because the branch is merged/rebased) — a rename is not a collision.
      if (holder.path === path) continue
      findings.push({ number: num, mine: path, theirs: holder.path, source: holder.source })
    }
  }
  return findings
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const tryGit = (args) => {
  try {
    return git(args)
  } catch {
    return null
  }
}

/** ADR paths tracked in the working tree. */
const treeAdrs = () =>
  (tryGit(['ls-files', `${ADR_DIR}/*.md`]) ?? '')
    .split('\n')
    .filter((p) => p && adrNumber(p) !== null)

/** Resolve the base ref, fetching it if this is a shallow CI checkout. */
const resolveBase = () => {
  const branch = process.env.ADR_BASE_REF || process.env.GITHUB_BASE_REF || 'main'
  for (const ref of [`origin/${branch}`, branch]) {
    if (tryGit(['rev-parse', '--verify', `${ref}^{commit}`])) return ref
  }
  // Shallow clone: the base branch may simply not have been fetched yet.
  if (tryGit(['fetch', '--no-tags', '--depth=1', 'origin', branch]) !== null) {
    if (tryGit(['rev-parse', '--verify', 'FETCH_HEAD^{commit}'])) return 'FETCH_HEAD'
  }
  return null
}

/** ADR paths present on the base ref. */
const baseAdrs = (base) =>
  (tryGit(['ls-tree', '-r', '--name-only', base, `${ADR_DIR}/`]) ?? '')
    .split('\n')
    .filter((p) => p && adrNumber(p) !== null)

/** This pull request's number, from the Actions event payload. */
const thisPrNumber = () => {
  const path = process.env.GITHUB_EVENT_PATH
  if (!path) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))?.pull_request?.number ?? null
  } catch {
    return null
  }
}

const api = async (url, token) => {
  const res = await fetch(url, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28'
    }
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

/**
 * ADR paths claimed by OPEN pull requests opened before `selfPr`. Throws on any API problem so
 * the caller can soft-skip — never converts an availability failure into a merge block.
 */
const peerAdrs = async (repo, token, selfPr) => {
  const prs = await api(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=100`, token)
  const earlier = prs.filter((pr) => pr.number < selfPr)
  const claimed = []
  for (const pr of earlier) {
    const files = await api(
      `https://api.github.com/repos/${repo}/pulls/${pr.number}/files?per_page=100`,
      token
    )
    for (const f of files) {
      if (f.status === 'removed') continue
      const num = adrNumber(f.filename)
      if (num !== null && f.filename.startsWith(`${ADR_DIR}/`)) {
        claimed.push({ number: num, path: f.filename, source: `PR #${pr.number}` })
      }
    }
  }
  return claimed
}

const main = async () => {
  const mineAll = treeAdrs()
  const notes = []

  // --- Check 1: BASE -------------------------------------------------------------------
  const base = resolveBase()
  if (base === null) {
    notes.push('base check SKIPPED — base ref not resolvable (no origin/main and no fetch)')
    // Without a base we cannot tell added from pre-existing, so there is nothing sound to
    // compare against; Q2b still covers the intra-tree duplicate case.
    process.stdout.write(`adr-number-check: ${notes.join('; ')}\n`)
    process.exit(0)
  }
  const onBase = baseAdrs(base)
  const onBaseSet = new Set(onBase)
  // "Added by this branch" = in the tree, not on base under the SAME filename.
  const added = mineAll.filter((p) => !onBaseSet.has(p))

  const findings = collisions(
    added,
    onBase.map((p) => ({ number: adrNumber(p), path: p, source: `base (${base})` }))
  )

  // --- Check 2: PEER -------------------------------------------------------------------
  const repo = process.env.GITHUB_REPOSITORY
  const token = process.env.GITHUB_TOKEN
  const selfPr = thisPrNumber()
  if (added.length === 0) {
    notes.push('peer check SKIPPED — this branch adds no ADR')
  } else if (!repo || !token || selfPr === null) {
    notes.push('peer check SKIPPED — not a token-bearing pull-request run')
  } else {
    try {
      findings.push(...collisions(added, await peerAdrs(repo, token, selfPr)))
      notes.push(`peer check ran against open PRs older than #${selfPr}`)
    } catch (err) {
      // Soft skip by design — see the failure-posture note in the header.
      notes.push(`peer check SKIPPED — GitHub API unavailable (${err.message})`)
    }
  }

  if (findings.length > 0) {
    process.stderr.write(`\nadr-number-check FAILED — ${findings.length} ADR number collision(s):\n`)
    for (const f of findings) {
      process.stderr.write(`  ✗ ADR ${f.number} is already claimed by ${f.source}: ${f.theirs}\n`)
      process.stderr.write(`      this branch adds: ${f.mine}\n`)
    }
    process.stderr.write(
      '\nRenumber THIS branch\'s ADR to the next free number (the earlier claim keeps it),\n' +
        'and update every reference to it. See docs/adrs/0020-documentation-drift-gate.md.\n'
    )
    process.exit(1)
  }

  const summary = added.length === 0 ? 'no ADR added' : `${added.length} ADR(s) added, no collision`
  process.stdout.write(`adr-number-check: ${summary} — ${notes.join('; ')}.\n`)
  process.exit(0)
}

// Only run when invoked directly, so the pure helpers above stay importable by the test.
if (process.argv[1] && process.argv[1].endsWith('adr-number-check.mjs')) {
  await main()
}
