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

if (findings.length > 0) {
  process.stderr.write(`\ndoc-link-check FAILED — ${findings.length} drift finding(s):\n`)
  for (const f of findings) process.stderr.write(`  ✗ ${f}\n`)
  process.stderr.write('\nUpdate the doc to the current path, or remove the stale reference.\n')
  process.exit(1)
}

process.stdout.write(`doc-link-check: ${docFiles.length} doc(s) scanned, ${adrs.length} ADR(s) — no broken references or duplicate numbers.\n`)
process.exit(0)
