# HG-0008 — Solution-agnostic seams: the data-risk register and the brand profile

- Status: **Proposed** — awaiting bank change-governance decision
- Date: 2026-06-24
- Scope: harness / AI-SDLC governance — the discovery harness seams
- Related: HG-0007 (the discovery gate these seams serve — D6, D7); HG-0002 (immutable control
  plane); `discovery/DISCOVERY.md` §5; `docs/governance/data-risk-register/README.md`;
  `discovery/brand/design.md`.

## Context

The discovery harness must be a **method**, reusable by any organisation — yet it must enforce
two organisation-specific things: *can we responsibly hold this data?* and *does this look like
it belongs to us?* If those were hard-coded to OFBO/CBUAE/the OFBO brand, the harness would be
an OFBO feature, not a method. The risk is the usual one: domain content leaks into the
machinery and the harness ossifies around one tenant.

## Requirements & regulatory basis

- **Data-governance feasibility (D6).** Discovery must assess data risk against a real
  regulation → risk → control → residual chain — for OFBO, the CBUAE/PDPL register — and prove
  referential integrity (no dangling risk/control citations). Mirrors BCBS 239 lineage rigour.
- **Brand conformance (D7).** Every artifact an entity's stakeholders see (HTML, documents,
  decks, spreadsheets, wireframes) must adhere to that entity's brand — tokens, not raw values —
  consistent with the binding "design tokens are the source of visual truth" rule.
- **Tenant-neutrality.** Neither requirement may be satisfied by code that names a specific
  organisation; both must be *mounted*, not *embedded*.

## Options

1. **Two mounted seams behind stable shapes (recommended).**
   - **Data-risk register** — JSON under `docs/governance/data-risk-register/` (regulations,
     taxonomy, risk statements, controls, residual risk). D6 and the `data-governance-reviewer`
     read the JSON only; another tenant mounts its own register behind the same shape. Ingest is
     deterministic from the source workbook (re-runnable, byte-identical).
   - **Brand profile** — a single `discovery/brand/design.md` holding design tokens, voice, and
     per-medium layout rules. Every visual step renders against it with token values only and
     embeds a conformance marker; D7 verifies marker + tokens-only. Swap the file → swap the brand.
   - **Pros:** the machinery hard-codes nothing tenant-specific; OFBO is just the mounted
     instance; verification is mechanical and dependency-free. **Cons:** two artifacts to keep
     current per tenant — but that is exactly where tenant truth *should* live.
2. **Hard-code OFBO content into the gates.** **Rejected** — turns the method into a feature;
   no reuse; every tenant forks the validator.
3. **External services** (a policy API for risk, a design system service for brand). **Rejected
   for now** — heavier, introduces runtime egress into a pure-Node gate path; revisit only if
   the file seams prove insufficient.

## Recommendation

**Option 1.** Keep both seams as in-repo, mechanically-verifiable files with stable shapes. The
register and `design.md` are *data the harness consumes*, never logic it branches on — the same
discipline as the deployment-profile adapter rule (core code never branches on the tenant).

## Decision

_Pending._ Once accepted: the register JSON and `design.md` shapes are versioned; changes to
either are tenant-content changes (not control-logic changes) but the *validator* that reads
them stays in the protected control plane (HG-0002).

## Consequences

- The discovery harness ports to a new organisation by mounting a register and a `design.md` —
  no code change.
- D6 and D7 stay honest and offline: referential integrity and brand conformance are checked by
  pure-Node code with zero network dependency.
- "Can we hold this data?" and "does this look like us?" become verifiable gate questions rather
  than reviewer opinion.
