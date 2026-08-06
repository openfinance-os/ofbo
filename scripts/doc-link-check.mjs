// HARNESS-05 — documentation-drift gate. Prose docs duplicate facts that live in code
// (file paths in evidence rows, skill instructions, ADR cross-references) and rot silently
// when the code moves. This is the deterministic doc analogue of Q1's generated-artifact
// diff-check: it does NOT judge whether prose is semantically current (an LLM reviewer can do
// that) — it mechanically fails when a doc points at something that no longer exists.
//
// Two checks, both deterministic:
//   1. Broken file references — every repo-relative path mentioned in a tracked doc must exist.
//   2. Duplicate ADR numbers — two ADRs sharing a NNNN prefix (the exact failure that slipped
//      past git when two open branches both grabbed 0018; git sees different filenames, not a clash).
//
// Run from the repo root: `node scripts/doc-link-check.mjs` (exit 1 on any finding).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

// Docs that describe CURRENT state — their references must resolve. Deliberately EXCLUDES
// docs/build-log.md (an append-only historical journal that legitimately cites files which
// existed at the time of an entry and were later moved/removed — enforcing live existence
// there would punish accurate history).
const DOC_FILES = [
  'CLAUDE.md',
  'README.md',
  'docs/PRD_Open_Finance_Back_Office.md',
  'packages/release-evidence/src/control-mappings.ts' // the evidence-reference registry (code, but a doc by purpose)
]
// Directories recursed for their *.md (git ls-files <dir> lists tracked files under it;
// `**` is NOT reliably expanded by git ls-files, so recurse a dir and filter instead).
const DOC_DIRS = ['docs/adrs', 'docs/governance', '.claude/skills', '.claude/agents']

// A path reference: starts at an UNAMBIGUOUS repo-root dir, ends in a known file extension
// followed by a boundary. Anchored to repo-root dirs so prose words with slashes ("and/or",
// "TPP/LFI") never match; `scripts`/`tests` are intentionally excluded — they appear constantly
// as cwd-relative command examples (e.g. `scripts/serve.ts` after a `cd services/bff`), which
// would be false positives. The trailing boundary stops `settings.json` matching as `.js`.
const TOPDIRS = String.raw`packages|services|apps|docs|specs|infra|\.claude|\.github`
const EXTS = String.raw`tsx|ts|mjs|cjs|js|json|ya?ml|sql|sh|svg|md|toml|tf`
const PATH_RE = new RegExp(
  String.raw`(?:^|[\s\`(\[<"'|])((?:${TOPDIRS})/[A-Za-z0-9._/-]+\.(?:${EXTS}))(?![A-Za-z0-9])`,
  'g'
)

const listFiles = (pathspec) => {
  try {
    return execFileSync('git', ['ls-files', pathspec], { encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch {
    return []
  }
}

const docFiles = [
  ...new Set([
    ...DOC_FILES.filter((f) => existsSync(f)),
    ...DOC_DIRS.flatMap((d) => listFiles(d).filter((f) => f.endsWith('.md')))
  ])
]
const findings = []

for (const doc of docFiles) {
  const lines = readFileSync(doc, 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const m of line.matchAll(PATH_RE)) {
      const ref = m[1]
      // Skip globs and placeholder segments — not literal paths.
      if (/[*<>{}]/.test(ref) || ref.includes('NN') || ref.includes('...')) continue
      if (!existsSync(ref)) {
        findings.push(`${doc}:${i + 1} → broken reference: ${ref}`)
      }
    }
  })
}

// Duplicate ADR numbers.
const adrs = listFiles('docs/adrs/*.md')
const byNumber = new Map()
for (const adr of adrs) {
  const num = adr.split('/').pop()?.match(/^(\d{4})-/)?.[1]
  if (!num) continue
  if (!byNumber.has(num)) byNumber.set(num, [])
  byNumber.get(num).push(adr)
}
for (const [num, files] of byNumber) {
  if (files.length > 1) findings.push(`duplicate ADR number ${num}: ${files.join(', ')}`)
}

// DOCS-01 — check 3: NUMERIC drift. A path reference rots loudly (the file is gone); a COUNT
// rots silently. The README claimed "76 paths, 10 tags" against a spec that had grown to 89/12,
// and "127 of the 135 backlog items" against 140/150 — both invisible to checks 1 and 2 because
// nothing was broken, just wrong. These are the counts a reader uses to size up the project, so
// they are derived here from the artefacts themselves and compared to the prose.
const countMatches = (file, re) => {
  try {
    return (readFileSync(file, 'utf8').match(re) ?? []).length
  } catch {
    return null
  }
}

const SPEC = 'specs/backoffice-openapi.yaml'
const specPaths = countMatches(SPEC, /^ {2}\//gm)
const specTags = countMatches(SPEC, /^ {2}- name:/gm)
// Items are `status: <value>` occurrences that are NOT the header comment's legend line.
const backlogSrc = (() => {
  try {
    return readFileSync('docs/backlog.yaml', 'utf8')
  } catch {
    return null
  }
})()
const backlogDone = backlogSrc ? (backlogSrc.match(/\bstatus:\s*done\b/g) ?? []).length : null

const readme = existsSync('README.md') ? readFileSync('README.md', 'utf8') : ''

// "**89 paths, 12 tags**" — the spec-size claim.
const claimedSpec = readme.match(/\*\*(\d+) paths, (\d+) tags\*\*/)
if (claimedSpec && specPaths !== null && specTags !== null) {
  if (Number(claimedSpec[1]) !== specPaths || Number(claimedSpec[2]) !== specTags) {
    findings.push(
      `README.md numeric drift: claims "${claimedSpec[1]} paths, ${claimedSpec[2]} tags" but ` +
        `${SPEC} has ${specPaths} paths and ${specTags} tags`
    )
  }
}

// "140 of the 150 backlog items are done" — the progress claim.
const claimedBacklog = readme.match(/(\d+) of the (\d+) backlog items are done/)
if (claimedBacklog && backlogDone !== null) {
  if (Number(claimedBacklog[1]) !== backlogDone) {
    findings.push(
      `README.md numeric drift: claims ${claimedBacklog[1]} backlog items done but ` +
        `docs/backlog.yaml has ${backlogDone}`
    )
  }
}

if (findings.length > 0) {
  process.stderr.write(`\ndoc-link-check FAILED — ${findings.length} drift finding(s):\n`)
  for (const f of findings) process.stderr.write(`  ✗ ${f}\n`)
  process.stderr.write('\nUpdate the doc to the current path, or remove the stale reference.\n')
  process.exit(1)
}

process.stdout.write(`doc-link-check: ${docFiles.length} doc(s) scanned, ${adrs.length} ADR(s) — no broken references or duplicate numbers.\n`)
process.exit(0)
