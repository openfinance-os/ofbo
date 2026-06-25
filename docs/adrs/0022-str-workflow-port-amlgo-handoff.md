# ADR 0022 — P10: the bank's STR workflow as a port; STR-draft handoff (BACKOFFICE-63)

- Status: **Accepted** — port approach chosen by the maintainer 2026-06-25
- Date: 2026-06-25
- Story: BACKOFFICE-63 (AML GO portal submission for STR drafts — Should, Ph2)
- Supersedes: [ADR 0010](0010-aml-go-str-submission.md) (which raised the question and proposed
  an AML-reporting port submitting to AML GO via P6; refined here to a handoff to the bank's STR
  workflow, per the PRD's "never submit directly" constraint)
- Builds on: BACKOFFICE-22 (fraud-suspected revocation auto-creates an STR draft) · BACKOFFICE-44 (four-eyes) · PRD §3 (institution-specific systems are ports)

## Context

BACKOFFICE-22 already auto-creates a Suspicious Transaction Report (STR) **draft** when a
fraud-suspected consent revocation is approved — but the Back Office only holds the draft
*reference*. BACKOFFICE-63 closes the loop: an **approved** STR draft must reach the CBUAE
**AML GO** portal. The binding constraint (PRD §7.2) is that **the Back Office never submits
to AML GO directly** — approved drafts flow to the *bank's existing STR workflow*, which is
the system of record that submits to the FIU.

That "bank's existing STR workflow" is a new external, institution-specific system the Back
Office must integrate with. Under CLAUDE.md rule 6 (compose, don't invent platform
primitives; genuinely-uncovered integration → raise an ADR), this is a decision for a human,
not a silent addition.

## Options

1. **A new canonical port — P10 (StrWorkflowPort).** Model the STR workflow as a port in
   the `PortMap`, exactly as PRD §3 prescribes for institution-specific systems, with a
   `sim` adapter (demo: records the handoff, never calls AML GO) and an `enterprise` stub
   (M6: the bank's real STR workflow). Pros: faithful to PRD §3; the demo↔enterprise swap is
   the established M6 mechanism; contract-tested like every other port; the "never submit
   directly" rule is structural (the Back Office only ever calls `handoffStrDraft`, never an
   AML GO client). Cons: extends the canonical P1–P9 set to P10 (a deliberate, reviewed
   change), and adds an adapter pair.
2. **A story-local handoff interface (not a numbered port).** An injected interface with a
   demo adapter, kept out of the canonical `PortMap`. Pros: lighter. Cons: STR handoff is a
   genuine external integration — keeping it out of the port framework is exactly the kind of
   special-casing the port abstraction exists to prevent; it would not get the port-contract
   suite or the M6 swap discipline.
3. **Reuse P3 (ITSM).** Raise the handoff as an ITSM ticket. Cons: conflates a specialised,
   regulated AML reporting workflow with generic ticketing; the STR workflow has its own
   acceptance semantics (a workflow reference, not a ticket id) and compliance ownership.

## Decision

**Option 1 — P10 (StrWorkflowPort).** It is the PRD-§3-faithful answer and makes the
"never submit directly" hard constraint *structural*: the Back Office composes only
`StrWorkflowPort.handoffStrDraft(...)` and has no AML GO client anywhere. The demo `sim`
adapter records a deterministic workflow reference; the `enterprise` adapter (M6) wires the
bank's real STR workflow and must pass exactly the port-contract suite the sim passes.

The STR-handoff flow reuses existing primitives — no new approval mechanism:
- The STR draft is persisted (created on fraud-revoke, BACKOFFICE-22; demo-seeded too).
- **Submitting a draft to the workflow is four-eyes-gated** (BACKOFFICE-44): a Compliance
  officer (`compliance:reports:generate`) initiates → `202` + `approval_request`; a **Risk**
  second-line (`risk:read`, the persona that owns STR triggers, PRD §2) approves via the
  generic approvals path. Only on that approval does `StrWorkflowPort.handoffStrDraft` run.
- The handoff is High-class audited (`str_draft_handed_off`, the approver as acting
  principal, the workflow reference recorded). No PII — the draft carries an internal
  consent ref + case context, never PSU identifiers.

## Consequences

- A new port `p10-str-workflow` joins `PortMap` / `PORT_NAMES`; the port-contract suite binds
  it, and the M6 enterprise stub inherits the swap-acceptance gate.
- BACKOFFICE-63 is buildable in the demo profile end-to-end with zero AML GO connectivity —
  the sim adapter proves the handoff, faults and all, without a scheme dependency.
- The "Back Office never submits to AML GO directly" rule is enforced by construction: there
  is no AML GO client in the codebase, only the STR-workflow port.
- Durable persistence (a Pg `str_draft` table with RLS + retention + BCBS 239 lineage) and
  the portal STR surface are follow-ups; the demo path defaults to an in-memory store behind
  the same `StrDraftStore` interface (the established "worker wires the durable Pg store"
  pattern).
