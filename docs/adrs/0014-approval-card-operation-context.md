# ADR 0014 — Operation context on four-eyes approval cards

- Status: **Accepted — Option 2** (user decision, 2026-06-21)
- Date: 2026-06-21
- Related: UI-05 (Four-Eyes Approval Portal), UX-03c, `specs/backoffice-openapi.yaml` `ApprovalRequest`, `apps/portal/src/lib/approvals.ts`; CLAUDE.md hard-stops (no PII on operational surfaces), PRD §2 (four-eyes)

## Context

The four-eyes approval card today shows the second approver only: `operation_type`
(e.g. `invoice_run`), `initiator`, `approver_required_scope`, and `expires_at`. It does
**not** show *what* is being approved — no amount, counterparty, or originating record.
This is not an oversight: the `ApprovalRequest` contract is **deliberately PII-redacted**
— it carries no `operation_payload`, by design, so the approval surface can never leak PSU
data.

The UI/UX review flagged the tension: a second authoriser approving a gated operation
(e.g. a TPP invoice run, a fraud-revoke) arguably needs *enough* context to make a real
judgment, not a rubber-stamp. But the four-eyes surface is exactly where PSU PII must not
appear. Surfacing operation context without leaking PII is a **regulated decision** — per
CLAUDE.md rule 6, humans (compliance) decide. Hence this ADR; UX-03c is blocked on it.

## The tension

- **Too little context** → the four-eyes control is theatre: the approver can't
  meaningfully assess what they're authorising, weakening the control's regulatory intent.
- **Too much context** → PSU PII (names, Emirates IDs, IBANs, account numbers, raw payment
  references) leaks onto a surface seen by a second principal who may not hold the data
  scope — a hard-stop violation and a residency/consent concern.

## Options

1. **Keep redacted (status quo).** The approver sees only `operation_type` + initiator +
   expiry. **Pros:** zero PII risk; no contract change. **Cons:** the four-eyes judgment is
   weak — the approver trusts the initiator + the operation label, nothing more.

2. **Add a minimal, typed, non-PII `operation_summary` to the contract (recommended).**
   Extend `ApprovalRequest` with an optional, **schema-constrained** `operation_summary`
   that carries only non-PII decision-relevant facts, e.g.:
   - money `amount` + `currency` (integer minor units; already a safe shape),
   - a **masked** counterparty label (e.g. TPP `display_name` or `client_id` — institutional,
     not PSU; never a PSU name),
   - a **count/scope descriptor** (e.g. "invoice run · 142 line items · period 2026-05"),
   - **never** PSU identifiers, account numbers, raw payment refs, or free text.
   The BFF composes this server-side from the gated operation at approval-request creation,
   applying the same redaction it already enforces. **Pros:** real four-eyes context within
   a PII-safe envelope; one typed field, not open free-form. **Cons:** a human-approved spec
   change + BFF work to compose the summary per operation type + a redaction test per type.

3. **Link out to a scope-gated detail view.** The card shows no payload, but a "view
   operation detail" link opens a separate view that re-checks the approver's data scope and
   renders detail only if they hold it. **Pros:** no PII on the card; detail only for
   scope-holders. **Cons:** most approvers won't hold the originating data scope (that's the
   point of four-eyes across personas) → usually a dead end; more surface area to secure.

## Recommendation

**Option 2.** A typed, non-PII `operation_summary` gives the approver enough to exercise a
real four-eyes judgment while keeping the surface PII-free by construction (schema-
constrained, BFF-composed, redaction-tested). It preserves the free-form-free, auditable
contract discipline. Option 1 is the safe default if compliance is not ready to define the
summary; Option 3 is a poor fit because cross-persona approvers rarely hold the data scope.

## Decision

**Option 2, accepted by the user on 2026-06-21.** Add the constrained, non-PII
`operation_summary` to `ApprovalRequest`.

Execution (per the `spec-change` skill — spec → tests → code):
1. **Spec PR #171** (open, awaiting human approval — NOT self-merged): adds the optional,
   nullable `operation_summary` + the `ApprovalOperationSummary` component
   (`amount`→Money, masked `counterparty_label`, non-PII `descriptor`, `additionalProperties:false`)
   and the regenerated contract types. Reviewers: hard-stop PASS, conformance CONFORMANT.
2. **After #171 merges**: a BFF story composes `operation_summary` per gated-operation type
   with a **per-type PII-redaction contract test** (the redaction is the load-bearing control).
3. **Then UX-03c**: the portal renders the summary on the approval card + the mobile detail.

Steps 2–3 are blocked on the human approval + merge of spec PR #171.

## Consequences

- Option 2: net-new optional contract field (additive, backward-compatible), BFF summary
  composition + redaction tests, and a small portal render. The four-eyes mechanism itself
  (initiator ≠ approver, `202` + `approval_request`, BFF execution) is unchanged.
- The DEMO banner, audit (INSERT-only, PII-redacted at emission), and egress posture are
  unaffected by any option.
- Whichever is chosen, the rule holds: **no PSU PII on the approval surface, ever** — Option 2
  is safe *because* the summary is schema-constrained to non-PII facts, not because we trust
  the composer.
