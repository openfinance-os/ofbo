// HARNESS-03 — collect agent build provenance for a release range and emit the BuildProvenance
// JSON the release-evidence CLI folds into the sealed bundle. Runs `git log` over
// <previous-tag>..<commit> (or the last N commits when there's no prior tag), parsing the
// Co-Authored-By / Claude-Session / Build-Model trailers the build loop stamps on every commit.
//
//   pnpm --filter @ofbo/release-evidence exec tsx scripts/collect-provenance.ts \
//     --commit <sha> [--prev <tag>] [--max <n>] > provenance.json
//
// NUL-delimits fields and RS-delimits records so commit bodies (which contain newlines and
// colons) survive intact. Pure read-only git; only the JSON goes to stdout (diagnostics → stderr),
// so the output pipes straight into a file. Reuses the unit-tested parser in ../src/provenance.
import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { parseGitLog, parseProvenance } from '../src/provenance.js'

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const commit = arg('commit') ?? process.env.GITHUB_SHA ?? 'HEAD'
const prev = arg('prev') // previous release tag, if any
const maxCount = arg('max') ?? '200'

// Range: since the previous release tag when known, else a bounded window so the bundle never
// walks the entire history on the very first release.
const range = prev ? `${prev}..${commit}` : commit
const args = ['log', `--max-count=${maxCount}`, '--format=%H%x00%an%x00%B%x1e', range]

let raw = ''
try {
  raw = execFileSync('git', args, { encoding: 'utf8' })
} catch (e) {
  process.stderr.write(
    `collect-provenance: git log failed (${e instanceof Error ? e.message : String(e)}); emitting empty provenance\n`
  )
}

const provenance = parseProvenance(parseGitLog(raw))
process.stdout.write(JSON.stringify(provenance, null, 2) + '\n')
