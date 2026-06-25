# ADR 0010 — AML GO STR submission (close BACKOFFICE-63)

- Status: **Superseded by [ADR 0022](0022-str-workflow-port-amlgo-handoff.md)** (2026-06-25)
- Date: 2026-06-20
- Superseded note: This ADR raised the question and recommended an AML-reporting port that
  submits to AML GO **via P6 egress**. The maintainer chose, and ADR 0022 records, the
  PRD-§7.2-faithful refinement: the Back Office **never submits to AML GO directly** — it
  hands an approved STR draft to the **bank's existing STR workflow** (a new port, P10), which
  is the system of record that files. The four-eyes + audit + status-tracking intent here is
  preserved in 0022; only the destination changed (the bank's STR workflow, not AML GO direct).
- Related: BACKOFFICE-22 (fraud revoke auto-creates STR drafts), BACKOFFICE-63 (deferred), P6 egress, P3 ITSM, the OF-UAE dual-role gap analysis (2026-06-20)

## Context

Fraud-suspected revocation (BACKOFFICE-22) **auto-creates an STR (Suspicious
Transaction Report) draft** and notifies Compliance. But the draft is never **submitted
to the CBUAE AML GO portal** — BACKOFFICE-63 (the submission step) is deferred. So the
back office produces the start of an AML trail and stops: drafts accumulate with no
submission path, no submission status, and no audit of filing. In a regulated AML
context a half-built STR trail is a material compliance risk — a bank could wrongly
assume reports are filed.

Closing this needs an **external integration to the AML GO portal**, which is a new
egress/auth surface (institution-specific) → by the ports model + CLAUDE.md rule 6 a
new primitive, hence this ADR.

## Requirements & regulatory basis

- **AML/CFT (CBUAE).** STR filing to the AML GO portal is **mandatory and time-bound**;
  non-submission is a serious compliance failure, independent of Open Finance.
- **Auditability.** Each submission must be attributable, INSERT-only audited, and
  status-tracked (drafted → submitted → acknowledged), with PII redacted at emission.
- **Controls.** STR submission is sensitive — should be four-eyes-gated (Compliance
  initiator ≠ approver) and routed via the bank's egress, never direct.

## Options

1. **AML GO submission via a dedicated port + tracked, four-eyes submission (recommended).**
   Add an AML-reporting port (institution-specific — sim adapter for demo, enterprise
   adapter at M6) that submits an STR draft to AML GO via P6 egress; gate submission with
   the existing four-eyes primitive; track status (drafted/submitted/acknowledged) with a
   High-class `str_submitted` audit (PII-redacted). **Pros:** composes four-eyes + audit +
   the ports model; demonstrable, controlled. **Cons:** a new port + a contract surface
   (spec-change) + the enterprise adapter is M6 (real AML GO credentials).
2. **Manual export for Compliance to file out-of-band.** Produce a signed export; humans
   submit. **Pros:** no integration. **Cons:** no in-system status/audit of filing; weak.
3. **Keep deferred.** Rejected as a stated position — leaving STR drafts unfiled is the
   risk this ADR exists to flag.

## Recommendation

**Option 1** — a dedicated AML-reporting port with four-eyes-gated, audited, status-tracked
submission via P6; sim adapter now, enterprise (real AML GO) at M6. Where a real
integration isn't available before M6, **Option 2's signed export is the interim**, but
the back office must still track submission status so drafts are never silently unfiled.

## Decision

_Pending._ Once chosen: open the spec-change for the submission endpoint + status, add
the AML port (interface + sim), wire four-eyes + audit, raise/close BACKOFFICE-63,
tests-first. Enterprise AML GO adapter lands at M6.

## Consequences

- New AML-reporting port + a contract surface (human-approved spec-change) + four-eyes +
  `str_submitted` audit + status model; enterprise adapter deferred to M6.
- Bank decision: AML GO integration details (interface, credentials, interim manual path).
- Until built, STR drafts created by -22 are **not filed** — the standing AML gap.
