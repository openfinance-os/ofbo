import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildEvidenceBundle, serializeBundle, type EvidenceBundleInput } from '../src/bundle.js'
import { QUALITY_GATES } from '../src/control-mappings.js'

/**
 * HARNESS-15 — the verifier must actually reject a tampered bundle. verifyEvidenceBundle() was
 * unit-tested as a function but had no caller; this exercises the SCRIPT the release workflow
 * runs, through its real exit codes, so the CI step cannot become a no-op that always exits 0.
 */

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(pkgRoot, 'scripts', 'verify-bundle.ts')
const tsx = join(pkgRoot, 'node_modules', '.bin', 'tsx')

let dir: string

const input: EvidenceBundleInput = {
  release: { tag: 'v9.9.9', commit: 'deadbeef', committed_at: '2026-08-07T00:00:00.000Z' },
  gates: QUALITY_GATES.map((g) => ({ gate: g.id, name: g.name, status: g.id === 'Q5' ? 'manual' : 'pass' })),
  test_results: [{ suite: 'unit', total: 1, passed: 1, failed: 0 }],
  scan_outputs: [],
  lineage_proof: { covered: ['audit_high_sensitivity'], gaps: [] }
}

/** Run the verifier; return its exit code rather than throwing. */
function run(...args: string[]): number {
  try {
    execFileSync(tsx, [script, ...args], { cwd: pkgRoot, stdio: 'pipe' })
    return 0
  } catch (e) {
    return (e as { status?: number }).status ?? 1
  }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'evidence-verify-'))
  const bundle = buildEvidenceBundle(input)
  writeFileSync(join(dir, 'good.json'), serializeBundle(bundle))

  // Two tampers, kept SEPARATE so each is proven on its own. Folding them into one file hid a
  // no-op: the fixture's Q4.5 is already 'pass' (derived), so writing 'pass' over it changed
  // nothing and only the lineage edit was doing any work.
  const gateTampered = JSON.parse(serializeBundle(bundle))
  const q45 = gateTampered.quality_gates.find((g: { gate: string }) => g.gate === 'Q4.5')
  expect(q45.status).toBe('pass') // guard: the flip below must be a real change
  q45.status = 'fail'
  writeFileSync(join(dir, 'tampered-gate.json'), JSON.stringify(gateTampered, null, 2))

  const lineageTampered = JSON.parse(serializeBundle(bundle))
  lineageTampered.lineage_proof.gaps = ['str_draft']
  writeFileSync(join(dir, 'tampered-lineage.json'), JSON.stringify(lineageTampered, null, 2))

  writeFileSync(join(dir, 'garbage.json'), 'not json at all')
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('verify-bundle script', () => {
  it('exits 0 for an intact bundle', () => {
    expect(run(join(dir, 'good.json'))).toBe(0)
  })

  it('exits non-zero when a gate verdict was altered under the seal', () => {
    expect(run(join(dir, 'tampered-gate.json'))).not.toBe(0)
  })

  it('exits non-zero when the lineage proof was altered under the seal', () => {
    expect(run(join(dir, 'tampered-lineage.json'))).not.toBe(0)
  })

  it('exits non-zero for an unreadable bundle rather than skipping it', () => {
    expect(run(join(dir, 'garbage.json'))).not.toBe(0)
  })

  it('refuses to report a vacuous pass when given no bundles', () => {
    expect(run()).not.toBe(0)
  })

  it('fails the whole run if any one of several bundles is bad', () => {
    expect(run(join(dir, 'good.json'), join(dir, 'tampered-gate.json'))).not.toBe(0)
  })
})
