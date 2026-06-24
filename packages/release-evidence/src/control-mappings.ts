/**
 * BACKOFFICE-57 — control mappings for the release evidence bundle. Each row
 * ties a regulatory/PRD control to the quality gate that exercises it and the
 * concrete evidence artifact, so an auditor can trace any control to its proof
 * in a release. The quality-gate taxonomy is the one in CLAUDE.md / PRD §6.
 */

export const QUALITY_GATES = [
  { id: 'Q1', name: 'build + unit' },
  { id: 'Q2', name: 'static analysis + SAST' },
  { id: 'Q3', name: 'integration + contract tests' },
  { id: 'Q4', name: 'security review + dependency scan' },
  { id: 'Q4.5', name: 'BCBS 239 lineage validation (P7)' },
  { id: 'Q5', name: 'manual approval to production' }
] as const

export type QualityGateId = (typeof QUALITY_GATES)[number]['id']

export interface ControlMapping {
  /** Regulatory or platform control being evidenced. */
  control: string
  /** Owning PRD requirement / backlog id(s). */
  requirement: string
  /** Quality gate(s) that exercise the control. */
  gates: QualityGateId[]
  /** Where the proof lives in the bundle / repo. */
  evidence: string
}

export const CONTROL_MAPPINGS: ControlMapping[] = [
  {
    control: 'Mandatory MFA sign-in via the enterprise IdP (no skip path)',
    requirement: 'BACKOFFICE-47',
    gates: ['Q1', 'Q3'],
    evidence: 'unit: services/bff/test/auth.spec; portal sign-in path'
  },
  {
    control: 'Persona scope-matrix enforcement (BFF + service layer), audited 403',
    requirement: 'BACKOFFICE-43',
    gates: ['Q1', 'Q3'],
    evidence: 'unit: services/bff/test/rbac.spec; contract-stubs scope checks'
  },
  {
    control: 'High-class audit write path is INSERT-only with PII redaction at emission',
    requirement: 'BACKOFFICE-45/-50/-51',
    gates: ['Q3'],
    evidence: 'integration: packages/db/test/audit.int.spec, retention.int.spec'
  },
  {
    control: 'Four-eyes approval primitive (202 + approval_request, no inline execute)',
    requirement: 'BACKOFFICE-44',
    gates: ['Q1', 'Q3'],
    evidence: 'unit: services/bff/test/approvals.spec; contract conformance'
  },
  {
    control: 'Platform super-admin guardrails (auto-signal, justification, no service accounts)',
    requirement: 'BACKOFFICE-80',
    gates: ['Q1', 'Q3'],
    evidence: 'unit: services/bff/test/superadmin.spec; integration superadmin.int.spec'
  },
  {
    control: 'OTel emission with x-fapi-interaction-id propagated end to end',
    requirement: 'BACKOFFICE-48',
    gates: ['Q1'],
    evidence: 'unit: services/bff/test/telemetry.spec'
  },
  {
    control: 'BCBS 239 column-level lineage emitted at write time for every table',
    requirement: 'BACKOFFICE-49',
    gates: ['Q4.5'],
    evidence: 'lineage_proof section: validateLineageCoverage (covered/gaps)'
  },
  {
    control: 'Data-classification metadata on every regulated record',
    requirement: 'BACKOFFICE-54',
    gates: ['Q3'],
    evidence: 'integration: packages/db/test/classification.int.spec'
  },
  {
    control: 'UAE data residency — region is an IaC parameter, enforced',
    requirement: 'BACKOFFICE-55',
    gates: ['Q1'],
    evidence: 'unit: infra/terraform/test/skeleton.spec'
  },
  {
    control: 'OpenAPI contract is ground truth (no drift; generated artifacts current)',
    requirement: 'API conventions (CLAUDE.md)',
    gates: ['Q1', 'Q3'],
    evidence: 'Q1 generated-artifact drift check; contract tests'
  },
  {
    control: 'Static analysis + SAST clean',
    requirement: 'CI/CD quality gates (CLAUDE.md)',
    gates: ['Q2'],
    evidence: 'scan_outputs: eslint, tsc, semgrep'
  },
  {
    control: 'Dependency vulnerability scan',
    requirement: 'BACKOFFICE-56 (Q4)',
    gates: ['Q4'],
    evidence: 'scan_outputs: dependency audit'
  },
  {
    control: 'Manual production approval (segregation of duties)',
    requirement: 'CI/CD Q5 (CLAUDE.md)',
    gates: ['Q5'],
    evidence: 'release approval record (GitHub environment / release sign-off)'
  },
  {
    control: 'Agent build provenance — model/session/story attributed per change (EU AI Act Art. 12/17)',
    requirement: 'HARNESS-03 (HG-0003 traceability)',
    gates: ['Q5'],
    evidence: 'provenance section: parseProvenance over the release commit range (git-trailer attribution)'
  }
]
