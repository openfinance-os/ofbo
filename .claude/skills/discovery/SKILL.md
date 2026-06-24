---
name: discovery
description: Run the discovery harness — the left half of the Double Diamond. Walks a problem through Discover → Define → Prototype → hand-off, producing gate-clean, brand-conformant artifacts under discovery/runs/<slug>/. Use to start or continue a discovery (problem framing, evidence synthesis, data-governance feasibility, a low-fi prototype) BEFORE any delivery story exists.
---

# Discovery — one pass of the left diamond

Canon: `discovery/DISCOVERY.md` (read it). This skill produces a **problem worth solving** plus
a **tangible prototype of the direction**, and stops at the hand-off. It never designs the
production solution, writes delivery stories, or touches `specs/backoffice-openapi.yaml` —
crossing that line is a gate failure (D4).

You are the discovery facilitator. Stay on the problem side. When a solution idea appears, park
it as a *direction* in the prototype/hand-off; do not specify a build.

## 0. Scaffold

Pick a slug. Create `discovery/runs/<slug>/` and copy each `discovery/templates/*.md` into it
(keep the `design_profile` front-matter). Create `evidence/`.

## 1. Discover (diverge → converge)

- `research-log.md`: log every signal with a stable id (`S-001…`), its source, and type. File
  backing artifacts under `evidence/`. **Synthetic data only** — tag illustrative signals
  `[synthetic]`. Zero real PII.
- `synthesis.md`: cluster signals into themes; **every theme traces to ≥1 signal id**; state a
  named prioritisation method; name the single candidate problem.

## 2. Define (converge)

- `problem-statement.md`: one falsifiable problem, target user, success measures (baseline →
  target), constraints, explicit out-of-scope, named stakeholders. Name the problem, not the build.
- `data-governance.md`: classify the data the direction would touch; map to the **register**
  (`docs/governance/data-risk-register/`) — cite ≥1 `DR-*` category and ≥1 regulatory driver;
  every `DR-*`/`CTRL-*` must resolve; record a residual-risk verdict and the conditions delivery
  inherits. (Feasibility is asked *here*, not in delivery.)

## 3. Prototype (make tangible)

- `prototype.md`: the brief — which framing hypotheses the wireframe tests, scope, fidelity
  guardrails. `fidelity: low`.
- `wireframe.html`: a **low-fidelity, disposable** wireframe rendered against
  `discovery/brand/design.md`. Use **token values only** (every colour/font must be a design.md
  token) and embed `<!-- brand-profile: discovery/brand/design.md@v1 -->`. Brand-real,
  behaviour-hollow: synthetic data, no live reads, no component/data contracts. This is to test
  *the problem and direction*, not to specify the solution (§4).

> **Brand rule (D7).** Anything visual this harness emits — HTML, generated docs, decks,
> spreadsheets, wireframes — renders against `design.md` with tokens only and carries the
> marker. Never inline a raw hex/px/font.

## 4. Gate, review, hand off

1. `node discovery/gates/validate.mjs discovery/runs/<slug>` — all applicable gates D1–D8 must
   pass. Fix artifacts until green; never weaken a gate to pass.
2. Spawn the reviewers (Agent tool): `data-governance-reviewer` (control coverage / residual
   soundness) and `discovery-boundary-reviewer` (no-solutioning / prototype fidelity). Resolve
   any FAIL.
3. `handoff.md`: the boundary object — problem, success measures, out-of-scope, the
   data-governance verdict + inherited conditions, and the prototype as *direction, not
   specification*. No delivery design in it.

## Definition of done

- All applicable D1–D8 gates green; both reviewers PASS.
- Every artifact carries the `design_profile`; the wireframe is brand-conformant.
- `handoff.md` contains no endpoints, schemas, stories, or tech choices.
- Synthetic data only; zero PII; DEMO banner on the wireframe.

Delivery (the `next-story` loop) consumes `handoff.md` to open its first story. The two
harnesses share governance — never authorship of the solution.
