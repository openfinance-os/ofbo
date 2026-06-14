import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { validateLineageCoverage } from '@ofbo/db'
import {
  buildEvidenceBundle,
  renderBundleMarkdown,
  serializeBundle,
  type EvidenceBundleInput,
  type GateResult,
  type LineageProof,
  type ScanOutput,
  type TestResults
} from './bundle.js'

/**
 * BACKOFFICE-57 — assemble and write the per-release evidence bundle, git-anchored
 * under <out>/<tag>/. Run by the release workflow on a published release/tag.
 *
 * Inputs:
 *   --tag <t> --commit <sha> [--ref <r>] [--out <dir=releases>]
 *   --input <gates+tests+scans json>   (the CI gate results for this release)
 * Lineage proof (Q4.5) is collected live from DATABASE_URL when set; otherwise
 * taken from the input file, else recorded as empty (a visible, honest gap).
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

interface InputFile {
  gates: GateResult[]
  test_results?: TestResults[]
  scan_outputs?: ScanOutput[]
  lineage_proof?: LineageProof
}

async function main(): Promise<void> {
  const tag = arg('tag') ?? process.env.GITHUB_REF_NAME
  const commit = arg('commit') ?? process.env.GITHUB_SHA
  const ref = arg('ref') ?? process.env.GITHUB_REF
  const outDir = arg('out') ?? 'releases'
  const inputPath = arg('input')

  if (!tag || !commit) throw new Error('release evidence requires --tag and --commit (or GITHUB_REF_NAME / GITHUB_SHA)')
  if (!inputPath) throw new Error('release evidence requires --input <gate-results.json>')

  const input = JSON.parse(readFileSync(inputPath, 'utf8')) as InputFile

  let lineage_proof: LineageProof = input.lineage_proof ?? { covered: [], gaps: [] }
  const dbUrl = process.env.DATABASE_URL
  if (dbUrl) lineage_proof = await validateLineageCoverage(dbUrl)

  const bundleInput: EvidenceBundleInput = {
    release: { tag, commit, ...(ref ? { ref } : {}), committed_at: new Date().toISOString() },
    gates: input.gates,
    test_results: input.test_results ?? [],
    scan_outputs: input.scan_outputs ?? [],
    lineage_proof
  }

  const bundle = buildEvidenceBundle(bundleInput)
  const dir = join(outDir, tag)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'evidence-bundle.json'), serializeBundle(bundle))
  writeFileSync(join(dir, 'evidence-bundle.md'), renderBundleMarkdown(bundle))
  process.stdout.write(`release evidence bundle written: ${join(dir, 'evidence-bundle.json')}\n`)
  process.stdout.write(`integrity ${bundle.integrity.algorithm}: ${bundle.integrity.digest}\n`)
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
