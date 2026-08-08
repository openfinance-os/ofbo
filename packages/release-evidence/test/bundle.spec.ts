import { describe, expect, it } from 'vitest'
import {
  buildEvidenceBundle,
  canonicalJson,
  EvidenceBundleError,
  EVIDENCE_SCHEMA_VERSION,
  renderBundleMarkdown,
  serializeBundle,
  verifyEvidenceBundle,
  type EvidenceBundleInput,
  type GateResult
} from '../src/bundle.js'
import { CONTROL_MAPPINGS, QUALITY_GATES } from '../src/control-mappings.js'

const ALL_GATES: GateResult[] = QUALITY_GATES.map((g) => ({
  gate: g.id,
  name: g.name,
  status: g.id === 'Q5' ? 'manual' : 'pass'
}))

function input(overrides: Partial<EvidenceBundleInput> = {}): EvidenceBundleInput {
  return {
    release: { tag: 'v1.2.0', commit: 'abc123', ref: 'refs/tags/v1.2.0', committed_at: '2026-06-14T12:00:00.000Z' },
    gates: ALL_GATES,
    test_results: [{ suite: 'unit', total: 243, passed: 243, failed: 0 }],
    scan_outputs: [{ tool: 'semgrep', status: 'pass', findings: 0 }],
    lineage_proof: { covered: ['audit_high_sensitivity', 'risk_signal'], gaps: [] },
    ...overrides
  }
}

describe('buildEvidenceBundle', () => {
  it('assembles every required section with the control mappings and git anchor', () => {
    const b = buildEvidenceBundle(input())
    expect(b.schema_version).toBe(EVIDENCE_SCHEMA_VERSION)
    expect(b.release.tag).toBe('v1.2.0')
    expect(b.release.commit).toBe('abc123')
    expect(b.control_mappings).toEqual(CONTROL_MAPPINGS)
    expect(b.quality_gates).toHaveLength(QUALITY_GATES.length)
    expect(b.test_results[0]?.passed).toBe(243)
    expect(b.scan_outputs[0]?.tool).toBe('semgrep')
    expect(b.lineage_proof.covered).toContain('audit_high_sensitivity')
    expect(b.integrity.algorithm).toBe('sha256')
    expect(b.integrity.digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects a bundle missing a required quality gate', () => {
    const partial = ALL_GATES.filter((g) => g.gate !== 'Q4.5')
    expect(() => buildEvidenceBundle(input({ gates: partial }))).toThrow(EvidenceBundleError)
    expect(() => buildEvidenceBundle(input({ gates: partial }))).toThrow(/Q4\.5/)
  })

  it('requires a complete git anchor (tag + commit)', () => {
    expect(() =>
      buildEvidenceBundle(input({ release: { tag: '', commit: '', committed_at: 'x' } }))
    ).toThrow(/git anchor/)
  })
})

// HARNESS-15 — Q4.5's status is DERIVED from the lineage proof the bundle carries, never
// trusted from the input. collect-gates.mjs writes a hardcoded `'pass'` for Q4.5 *before* the
// proof exists (the CLI collects it later from DATABASE_URL), so a bundle could assert a
// passing BCBS 239 gate while listing uncovered regulated tables in the section below it.
describe('Q4.5 lineage gate derivation', () => {
  it('reds the gate when the proof reports gaps, whatever the input claimed', () => {
    // ALL_GATES supplies Q4.5 as 'pass' — exactly the hardcoded literal the defect shipped.
    const b = buildEvidenceBundle(
      input({ lineage_proof: { covered: ['risk_signal'], gaps: ['audit_high_sensitivity', 'str_draft'] } })
    )
    const q45 = b.quality_gates.find((g) => g.gate === 'Q4.5')
    expect(q45?.status).toBe('fail')
    expect(q45?.summary).toContain('audit_high_sensitivity')
    expect(q45?.summary).toContain('str_draft')
  })

  it('marks the gate skipped when no proof was collected at all', () => {
    // cli.ts records `{ covered: [], gaps: [] }` when DATABASE_URL is unset — an honest gap,
    // which is not the same thing as a gate that ran and found nothing wrong.
    const b = buildEvidenceBundle(input({ lineage_proof: { covered: [], gaps: [] } }))
    expect(b.quality_gates.find((g) => g.gate === 'Q4.5')?.status).toBe('skipped')
  })

  it('passes only when tables are covered and no gap remains', () => {
    const b = buildEvidenceBundle(
      input({ lineage_proof: { covered: ['audit_high_sensitivity', 'risk_signal'], gaps: [] } })
    )
    const q45 = b.quality_gates.find((g) => g.gate === 'Q4.5')
    expect(q45?.status).toBe('pass')
    expect(q45?.summary).toContain('2')
  })

  it('cannot be talked into a pass by an input that claims one', () => {
    const lying: GateResult[] = ALL_GATES.map((g) =>
      g.gate === 'Q4.5' ? { ...g, status: 'pass', summary: 'all good, honest' } : g
    )
    const b = buildEvidenceBundle(
      input({ gates: lying, lineage_proof: { covered: [], gaps: ['fraud_incident'] } })
    )
    expect(b.quality_gates.find((g) => g.gate === 'Q4.5')?.status).toBe('fail')
  })

  it('leaves every other gate exactly as supplied', () => {
    const b = buildEvidenceBundle(input({ lineage_proof: { covered: ['x'], gaps: ['y'] } }))
    for (const g of b.quality_gates.filter((g) => g.gate !== 'Q4.5')) {
      expect(g).toEqual(ALL_GATES.find((a) => a.gate === g.gate))
    }
    expect(b.quality_gates.map((g) => g.gate)).toEqual(ALL_GATES.map((g) => g.gate))
  })
})

describe('integrity', () => {
  it('verifies an untampered bundle', () => {
    expect(verifyEvidenceBundle(buildEvidenceBundle(input()))).toBe(true)
  })

  it('detects tampering with any evidenced field', () => {
    const b = buildEvidenceBundle(input())
    const tampered = { ...b, test_results: [{ suite: 'unit', total: 243, passed: 200, failed: 43 }] }
    expect(verifyEvidenceBundle(tampered)).toBe(false)
  })

  it('seals build provenance into the digest (attribution cannot be altered silently)', () => {
    const b = buildEvidenceBundle(
      input({ provenance: { commits: [{ commit: 'abc', author: 'bot', model: 'Claude Opus 4.8', session: 's', story: 'BACKOFFICE-1' }], build_agents: ['Claude Opus 4.8'], unattributed_commits: 0 } })
    )
    expect(verifyEvidenceBundle(b)).toBe(true)
    const tampered = { ...b, provenance: { ...b.provenance, build_agents: ['Some Other Model'] } }
    expect(verifyEvidenceBundle(tampered)).toBe(false)
  })

  it('defaults to an empty (honest-gap) provenance record when none is supplied', () => {
    const b = buildEvidenceBundle(input())
    expect(b.provenance).toEqual({ commits: [], build_agents: [], unattributed_commits: 0 })
  })

  it('digest is stable regardless of key order (canonical JSON)', () => {
    const a = buildEvidenceBundle(input())
    const reordered = buildEvidenceBundle(
      input({ release: { committed_at: '2026-06-14T12:00:00.000Z', commit: 'abc123', ref: 'refs/tags/v1.2.0', tag: 'v1.2.0' } })
    )
    expect(reordered.integrity.digest).toBe(a.integrity.digest)
  })

  it('canonicalJson sorts keys deterministically', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })
})

describe('control mappings', () => {
  it('cover every quality gate Q1–Q5 and Q4.5', () => {
    const referenced = new Set(CONTROL_MAPPINGS.flatMap((c) => c.gates))
    for (const g of QUALITY_GATES) {
      expect(referenced.has(g.id), `no control maps to gate ${g.id}`).toBe(true)
    }
  })

  it('include the load-bearing regulatory controls (residency, lineage, audit, four-eyes)', () => {
    const controls = CONTROL_MAPPINGS.map((c) => c.control.toLowerCase()).join(' | ')
    expect(controls).toMatch(/residency/)
    expect(controls).toMatch(/lineage/)
    expect(controls).toMatch(/insert-only/)
    expect(controls).toMatch(/four-eyes/)
  })
})

describe('serialisation', () => {
  it('serialises to pretty JSON ending in a newline', () => {
    const s = serializeBundle(buildEvidenceBundle(input()))
    expect(s.endsWith('}\n')).toBe(true)
    expect(JSON.parse(s).integrity.digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('renders a markdown companion with all sections', () => {
    const md = renderBundleMarkdown(buildEvidenceBundle(input()))
    expect(md).toContain('# Release evidence bundle — v1.2.0')
    expect(md).toContain('## Quality gates')
    expect(md).toContain('## Scan outputs')
    expect(md).toContain('## BCBS 239 lineage proof')
    expect(md).toContain('## Build provenance')
    expect(md).toContain('## Control mappings')
  })
})
