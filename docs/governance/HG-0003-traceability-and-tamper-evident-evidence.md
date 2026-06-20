# HG-0003 — Externally-anchored traceability + tamper-evident change records

- Status: **Proposed** — awaiting bank change-governance decision
- Date: 2026-06-20
- Scope: harness / AI-SDLC governance
- Related: HG-0001 (each merge names a change record), BACKOFFICE-57 (release-evidence bundle); the harness bank-readiness review (2026-06-20)

## Context

The harness's change records are **written by the agent**: `docs/backlog.yaml` (status)
and `docs/build-log.md` (the narrative of what shipped). This is self-attestation, and
this session it was demonstrably unreliable — a codebase-vs-PRD audit found stories
marked `done` whose read-side surfaces were still stubbed, and a near-loss commit was
recovered only by luck. The sealed release-evidence bundle (BACKOFFICE-57) is good but is
*triggered by the agent* and anchored in-repo. A bank's change audit must be
**independent of the party making the change** and **tamper-evident**.

## Requirements & regulatory basis

- **Traceability.** Every change traces to an externally-approved requirement/change
  record (ticket), not just an agent-edited backlog.
- **Tamper-evidence / independence.** The audit trail of *who approved, what changed,
  when* must not be writable by the agent and should be externally retained.
- **Reconcilable DoD.** "Done" must be independently verifiable, not self-declared.

## Options

1. **Anchor changes to an external change-record system + independent evidence (recommended).**
   - Require every PR to reference an **approved change ticket** (Jira/ITSM) carrying the
     human approval (ties to HG-0001); CI fails a PR with no valid linked ticket.
   - Generate the evidence bundle in CI (not by the agent) and ship it to **external,
     append-only storage** (the build log/backlog stay as developer convenience, not the
     system of record).
   - Add an **independent DoD check** (e.g., contract-test coverage of every spec path,
     run in CI) so "done" can't be self-asserted past a stub.
   - **Pros:** audit independent of the agent; reconcilable; reuses the existing
     evidence-bundle mechanism, just relocated + CI-owned. **Cons:** needs an ITSM/Jira
     integration + external evidence store.
2. **Keep in-repo records, add signing.** Sign build-log/evidence commits for
   tamper-evidence. **Pros:** light. **Cons:** still agent-authored/self-attested; signing
   proves *who committed*, not that the content is true.
3. **Status quo.** Rejected — self-attested records already proved unreliable.

## Recommendation

**Option 1** — external change-ticket linkage (CI-enforced) + CI-generated evidence to
append-only storage + an independent DoD/coverage check.

## Decision

_Pending._ Once accepted: pick the change-record system, add the PR→ticket CI check,
move evidence generation into CI with external retention, and add the independent
spec-path coverage gate.

## Consequences

- The build-log/backlog become aids, not the audit of record.
- Closes the self-attestation gap that let "done" overstate completeness.
- Depends on HG-0001 (the ticket carries the human approval) and an ITSM integration.
