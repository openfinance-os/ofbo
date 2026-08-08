import { createHash } from 'node:crypto'
import { CONTROL_MAPPINGS, QUALITY_GATES, type ControlMapping, type QualityGateId } from './control-mappings.js'
import { EMPTY_PROVENANCE, type BuildProvenance } from './provenance.js'

/**
 * BACKOFFICE-57 — assembles the per-release evidence bundle (control mappings,
 * test results, scan outputs, lineage proofs, git anchor) with a tamper-evident
 * integrity digest. Pure: callers collect the inputs (CI gate results, lineage
 * report, git metadata); this module validates completeness and serialises.
 */

export const EVIDENCE_SCHEMA_VERSION = '1.0.0'

export type GateStatus = 'pass' | 'fail' | 'manual' | 'skipped'

export interface GateResult {
  gate: QualityGateId
  name: string
  status: GateStatus
  summary?: string
}

export interface TestResults {
  suite: string
  total: number
  passed: number
  failed: number
}

export interface ScanOutput {
  tool: string
  status: GateStatus
  findings: number
  summary?: string
}

export interface LineageProof {
  covered: string[]
  gaps: string[]
}

export interface GitAnchor {
  tag: string
  commit: string
  ref?: string
  committed_at: string
}

export interface EvidenceBundleInput {
  release: GitAnchor
  gates: GateResult[]
  test_results: TestResults[]
  scan_outputs: ScanOutput[]
  lineage_proof: LineageProof
  /** Agent build provenance for the release range. Optional — defaults to an empty (honest-gap) record. */
  provenance?: BuildProvenance
}

export interface EvidenceBundle {
  schema_version: string
  release: GitAnchor
  control_mappings: ControlMapping[]
  quality_gates: GateResult[]
  test_results: TestResults[]
  scan_outputs: ScanOutput[]
  lineage_proof: LineageProof
  provenance: BuildProvenance
  integrity: { algorithm: 'sha256'; digest: string }
}

/** Deterministic JSON: object keys sorted recursively so the digest is stable. */
export function canonicalJson(value: unknown): string {
  const seen = new WeakSet<object>()
  const norm = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v
    if (seen.has(v as object)) throw new Error('cannot canonicalise a cyclic structure')
    seen.add(v as object)
    if (Array.isArray(v)) return v.map(norm)
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, norm((v as Record<string, unknown>)[k])])
    )
  }
  return JSON.stringify(norm(value))
}

export class EvidenceBundleError extends Error {}

/**
 * HARNESS-15 — Q4.5's verdict is DERIVED from the lineage proof, never taken from the caller.
 *
 * `collect-gates.mjs` writes a hardcoded `status: 'pass'` for Q4.5, and it writes it *before*
 * the proof exists: the CLI collects the live coverage from DATABASE_URL afterwards. Nothing
 * reconciled the two, so a sealed bundle could assert a passing BCBS 239 gate while the lineage
 * section listed uncovered regulated tables — a control that cannot report its own failure,
 * which is the class HARNESS-07 and HARNESS-09 exist to close. The proof is the only thing that
 * knows the answer, so the proof decides.
 *
 * Empty-and-no-gaps is `skipped`, not `pass`: `cli.ts` records `{ covered: [], gaps: [] }` when
 * DATABASE_URL is unset, and "no proof was collected" must not read as "the gate passed".
 */
export function deriveLineageGateStatus(proof: LineageProof): { status: GateStatus; summary: string } {
  if (proof.gaps.length > 0) {
    return { status: 'fail', summary: `lineage gaps (${proof.gaps.length}): ${proof.gaps.join(', ')}` }
  }
  if (proof.covered.length === 0) {
    return { status: 'skipped', summary: 'no lineage proof collected (DATABASE_URL unset or no regulated tables observed)' }
  }
  return { status: 'pass', summary: `${proof.covered.length} regulated tables covered, no gaps` }
}

/**
 * Build and seal the bundle. Throws if a required gate is missing or the git
 * anchor is incomplete — an evidence bundle with holes is worse than none.
 */
export function buildEvidenceBundle(input: EvidenceBundleInput): EvidenceBundle {
  if (!input.release?.tag || !input.release?.commit) {
    throw new EvidenceBundleError('release evidence bundle requires a git anchor (tag + commit)')
  }
  const present = new Set(input.gates.map((g) => g.gate))
  const missing = QUALITY_GATES.filter((g) => !present.has(g.id)).map((g) => g.id)
  if (missing.length > 0) {
    throw new EvidenceBundleError(`evidence bundle missing required quality gates: ${missing.join(', ')}`)
  }

  // Q4.5 is re-stated from the proof (HARNESS-15). Every other gate is carried through exactly
  // as the caller supplied it — CI step outcomes are the only witness those gates have.
  const lineage = deriveLineageGateStatus(input.lineage_proof)
  const gates = input.gates.map((g) => (g.gate === 'Q4.5' ? { ...g, ...lineage } : g))

  const content = {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    release: input.release,
    control_mappings: CONTROL_MAPPINGS,
    quality_gates: gates,
    test_results: input.test_results,
    scan_outputs: input.scan_outputs,
    lineage_proof: input.lineage_proof,
    provenance: input.provenance ?? EMPTY_PROVENANCE
  }
  const digest = createHash('sha256').update(canonicalJson(content)).digest('hex')
  return { ...content, integrity: { algorithm: 'sha256', digest } }
}

/** Recompute the digest over the content and compare — proves the bundle is intact. */
export function verifyEvidenceBundle(bundle: EvidenceBundle): boolean {
  const { integrity, ...content } = bundle
  const digest = createHash('sha256').update(canonicalJson(content)).digest('hex')
  return integrity.algorithm === 'sha256' && integrity.digest === digest
}

export function serializeBundle(bundle: EvidenceBundle): string {
  return JSON.stringify(bundle, null, 2) + '\n'
}

/** Human-readable companion committed alongside the JSON. */
export function renderBundleMarkdown(bundle: EvidenceBundle): string {
  const gateRow = (g: GateResult) => `| ${g.gate} | ${g.name} | ${g.status} | ${g.summary ?? ''} |`
  const scanRow = (s: ScanOutput) => `| ${s.tool} | ${s.status} | ${s.findings} | ${s.summary ?? ''} |`
  const testRow = (t: TestResults) => `| ${t.suite} | ${t.total} | ${t.passed} | ${t.failed} |`
  const ctlRow = (c: ControlMapping) => `| ${c.control} | ${c.requirement} | ${c.gates.join(', ')} | ${c.evidence} |`
  return [
    `# Release evidence bundle — ${bundle.release.tag}`,
    '',
    `- Commit: \`${bundle.release.commit}\``,
    `- Ref: \`${bundle.release.ref ?? bundle.release.tag}\``,
    `- Generated: ${bundle.release.committed_at}`,
    `- Schema: ${bundle.schema_version}`,
    `- Integrity (${bundle.integrity.algorithm}): \`${bundle.integrity.digest}\``,
    '',
    '## Quality gates',
    '',
    '| Gate | Name | Status | Summary |',
    '| --- | --- | --- | --- |',
    ...bundle.quality_gates.map(gateRow),
    '',
    '## Test results',
    '',
    '| Suite | Total | Passed | Failed |',
    '| --- | --- | --- | --- |',
    ...bundle.test_results.map(testRow),
    '',
    '## Scan outputs',
    '',
    '| Tool | Status | Findings | Summary |',
    '| --- | --- | --- | --- |',
    ...bundle.scan_outputs.map(scanRow),
    '',
    '## BCBS 239 lineage proof (Q4.5)',
    '',
    `- Covered tables: ${bundle.lineage_proof.covered.join(', ') || '(none observed)'}`,
    `- Gaps: ${bundle.lineage_proof.gaps.join(', ') || 'none'}`,
    '',
    '## Build provenance (agent attribution — EU AI Act Art. 12/17)',
    '',
    `- Build agents: ${bundle.provenance.build_agents.join(', ') || '(none recorded)'}`,
    `- Commits in range: ${bundle.provenance.commits.length} (${bundle.provenance.unattributed_commits} unattributed)`,
    '',
    '| Commit | Model | Story | Session |',
    '| --- | --- | --- | --- |',
    ...bundle.provenance.commits.map(
      (c) => `| \`${c.commit.slice(0, 12)}\` | ${c.model ?? '—'} | ${c.story ?? '—'} | ${c.session ?? '—'} |`
    ),
    '',
    '## Control mappings',
    '',
    '| Control | Requirement | Gates | Evidence |',
    '| --- | --- | --- | --- |',
    ...CONTROL_MAPPINGS.map(ctlRow),
    ''
  ].join('\n')
}
