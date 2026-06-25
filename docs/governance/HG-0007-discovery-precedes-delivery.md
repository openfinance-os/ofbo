# HG-0007 — Discovery precedes delivery (the left-diamond gate)

- Status: **Accepted** (harness-owner direction, 2026-06-25) — bank change-governance
  ratification still required before production branch protection (see Decision)
- Date: 2026-06-24 (proposed) · 2026-06-25 (accepted)
- Scope: harness / AI-SDLC governance — the discovery harness (`discovery/`)
- Related: HG-0001 (human four-eyes — discovery hand-off is a human decision point);
  HG-0002 (immutable control plane — the gate validator lives in the protected surface);
  HG-0008 (the solution-agnostic seams discovery depends on); `discovery/DISCOVERY.md`.

## Context

The delivery harness (the `next-story` loop, Q1–Q5 gates) is very good at *building the thing
right* and entirely silent on *whether it is the right thing*. Stories enter from
`docs/backlog.yaml` with no recorded evidence that the problem was framed, that data-governance
feasibility was assessed before code, or that anyone saw the direction made tangible. The
Double Diamond's left half — Discover and Define — was unmanaged. This is where regulated
build programmes waste the most: delivering a well-built answer to the wrong question, or
discovering a data-governance blocker only after implementation.

## Requirements & regulatory basis

- **Problem traceability.** A delivered feature should trace to an evidenced problem, not an
  unsourced request. (Auditability; BCBS 239 lineage extends naturally to "why was this built".)
- **Feasibility before build.** Data-governance acceptability (PDPL/CPS, residual risk) must be
  assessed in discovery, not retrofitted — mirrors the delivery hard-stop that lineage/PII
  controls are Definition-of-Done.
- **Separation of problem from solution.** The party framing the problem must not smuggle in the
  build; the solution is authored under the delivery controls, with its own four-eyes.

## Options

1. **A gated discovery harness feeding delivery (recommended).**
   - `discovery/runs/<slug>/` artifacts validated by a pure-Node gate validator **D1–D8**
     (framing, evidence, scope, no-solutioning, synthesis integrity, data-governance
     feasibility, brand conformance, tangibility); a `handoff.md` boundary object opens a
     delivery story.
   - Two reviewer agents (`data-governance-reviewer`, `discovery-boundary-reviewer`) add the
     judgement the mechanical gates can't.
   - **Pros:** features enter delivery with an evidenced problem, a feasibility verdict, and a
     tangible, stakeholder-tested direction; the no-solutioning gate keeps authorship separated.
     **Cons:** a front-loaded step before the build loop — by design.
2. **Lightweight template only** (a problem-statement doc, no gates). **Rejected** — unenforced;
   the same drift the delivery gates exist to prevent.
3. **Fold discovery into delivery** (one harness). **Rejected** — collapses the problem/solution
   separation and the four-eyes between them.

## Recommendation

**Option 1.** Make a validated discovery hand-off the normal entry path for a feature-bearing
backlog item. The gate validator and reviewers join the protected control plane (HG-0002), so
they cannot be weakened by the build loop they govern.

## Decision

**Accepted (harness-owner, 2026-06-25).** A green discovery hand-off is the entry condition for
a feature-bearing backlog item. Mechanically enforced:

- **The waist gate** — `scripts/discovery-link-check.mjs` (CI `discovery-gates` job). A
  `BACKOFFICE-NN` item may only be `status: pending` if it carries `discovery: <slug>` resolving
  to a `discovery/runs/<slug>/handoff.md` that passes **all** applicable gates (reuses the
  D1–D9 validator). Escape hatch: `discovery_exempt: true` + `reason:` for pre-policy legacy
  items. Infra (`M*-`) items are not gated. The `next-story` loop honours the same rule in its
  Pick step, so the loop cannot front-run an unframed feature.
- **Gate D9 (validation loop)** — the hand-off now inherits a *stakeholder-tested* direction,
  not just a built prototype: D9 fails a run whose prototype was never reacted to (canon §3/§4).
- **The Develop phase (HG-0009)** — the `develop` skill is what normally turns a hand-off into
  the chosen solution direction and appends the discovery-linked backlog item, so the waist gate
  is satisfied by construction rather than by hand.

**Grandfathering.** The policy binds work that becomes `pending` after adoption; the ~135 items
already shipped are not retro-linked (history is not rewritten). An un-statused stub trips the
gate only when someone marks it `pending` to build it — which is exactly when a hand-off is due.

**Remaining human step (bank change-governance).** Production branch protection on
`docs/backlog.yaml` + adding the discovery/gate control surface to **CODEOWNERS** (HG-0002) — so
the gate cannot be removed by the loop it governs — is the bank's ratification decision. No
CODEOWNERS file exists yet; owners are not fabricated here.

**Prior mechanism (now part of the above):** the `discovery-gates` job already validated every
`discovery/runs/*` through the gate validator on each PR — pure-Node, dependency-free.

## Consequences

- A feature's *why* becomes a first-class, audited artifact alongside its *how*.
- Data-governance blockers surface in discovery, cheaply, against the register (HG-0008/D6).
- The harness stays solution-agnostic: the same machinery runs discovery for any organisation
  that mounts its own seams.
