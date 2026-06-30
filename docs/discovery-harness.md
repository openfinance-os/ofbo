# Discovery Harness — seed

> Seed file. The Loom has two diamonds. The **delivery harness** is built and running
> (`CLAUDE.md` conventions, the `.claude/skills` autonomous loop, the reviewer agents, the
> CI quality gates, the `docs/governance/` controls). The **discovery harness** — the first
> diamond — is still light today: it lives as the PRD, the backlog and the ADRs rather than a
> dedicated harness. This file defines discovery, and the machinery to build for it, the same
> way `CLAUDE.md` + the skills seed delivery. Commit it, then run `DISCOVERY-00..` through the
> loop to build the harness out.

## 1. The Double Diamond — definitions

Two diamonds. Each **diverges** (open up, explore widely) then **converges** (narrow down,
decide). The first diamond is about the *problem*; the second is about the *solution*.

**Diamond 1 — DISCOVERY (the problem).**
- **Discover (diverge).** Understand the *real* issue rather than the assumed one. Gather
  evidence widely — from users and stakeholders, the market, the regulatory landscape, the
  data, and the current state. The output is an *evidence base*, never a solution.
- **Define (converge).** Distil the evidence into a framed problem, a business case, and a
  scope. The output is an *agreed problem statement*.

**Diamond 2 — DELIVERY (the solution).**
- **Develop (diverge).** Explore solutions — architecture, ADRs, the spec-first OpenAPI
  contract, candidate designs, the P1–P9 ports.
- **Deliver (converge).** Build it under control — implement to green, the quality gates,
  four-eyes merge, auto-deploy, sealed evidence.

The two diamonds meet at a single artifact: the **agreed problem statement = the PRD** — the
hand-off from discovery to delivery. The process is **non-linear**: evidence found during
delivery can legitimately send you back a diamond.

**Loom mapping.** Discovery and delivery are the loom's two *harnesses*; the always-on
controls are the *warp*; the AI agents are the *shuttle*; the institution's context (its
brain) is the *pattern*; the shipped, audit-ready solution is the *cloth*.

## 2. Definition of done for a discovery

A discovery is **done** when there is an **agreed, evidence-backed problem statement** that can
seed delivery — a PRD-shaped document carrying: the framed problem, the affected users, a
business case, scope (in / out), success metrics, a named owner, regulatory and risk
feasibility, and an investment / CEC sign-off. *Or* a documented decision to stop: a discovery
is allowed to fail, and stopping the wrong problem early is a win.

## 3. The discovery harness — target design (a mirror of delivery)

### Stages

1. **Frame** the challenge — strategy / OKRs, a regulatory mandate, a customer or market
   signal, an exec sponsor ask, or a pain point / incident.
2. **Discover (diverge)** — evidence, not solutions:
   - stakeholder & user research (interviews, shadowing, jobs-to-be-done);
   - market & competitor scan (what exists, benchmarks, gaps, build-vs-buy signals);
   - regulatory & risk landscape (mandates, deadlines, a discovery-mode risk review,
     feasibility & constraints);
   - data & signal analysis (current-state metrics, sizing the pain);
   - current-state journey / process map (where it breaks).
   → an **evidence base**.
3. **Define (converge)**:
   - synthesize → insight themes (cluster the evidence, trace cause and effect);
   - problem framing ("How might we…" — an opportunity, not a solution);
   - **business case** (NPV / IRR, cost-benefit, options & trade-offs);
   - prioritise & scope (in / out, success metrics) → a draft problem statement.
   - **Optional RFP branch (build-vs-buy):** RFI → RFP → scored (weighted) evaluation →
     shortlist + PoC / demo → partner selection; the vendor-shaped constraints fold back into
     the problem statement.
4. **Gate** — investment / CEC committee approval + problem-statement sign-off. This is the
   **four-eyes of discovery**; kill-criteria can stop here.
5. **Hand off** — the agreed problem statement becomes the **PRD + acceptance criteria**
   (plus any selected partner) and seeds the delivery canon: `CLAUDE.md`,
   `docs/PRD_Open_Finance_Back_Office.md`, `specs/backoffice-openapi.yaml`, `docs/backlog.yaml`.

### Guardrails (the discovery hard-stops, analogous to delivery's)

- **Evidence over assertion.** Every claim in the problem statement or business case cites a
  source or signal. No unsupported assertions.
- **People-centred.** Real users / affected parties are in the loop.
- **Visualise & make it tangible.** Map it; don't just describe it.
- **Kill-criteria.** A discovery may fail. Record the decision and stop.
- **Early regulatory / risk feasibility.** No dead-end problem reaches delivery.
- **No solutioning in Discover.** Discover gathers the problem; solutions belong to Develop.

## 4. How to build the harness (the machinery to add)

The delivery harness is: **canon** (`CLAUDE.md`) + **skills** (the autonomous loop) +
**reviewer agents** + **gates** + **governance** + **checked-in evidence**. Build the same
shape for discovery.

### Canon
- `docs/DISCOVERY.md` — binding discovery conventions (the rules in this file), the analogue of
  `CLAUDE.md`: the stages, the guardrails, the artifact formats, the DoD, and the **hand-off
  contract** (what a PRD seed must contain).
- A **discovery backlog** (`docs/discovery-backlog.yaml`) — both the opportunities to run
  through the harness and the harness-build stories (`DISCOVERY-01..`).

### Artifacts (checked in, versioned — the discovery audit trail)
A `discovery/<slug>/` folder per opportunity:
- `evidence/` — sources, interviews, scans, data pulls (each cited);
- `insights.md` — the synthesized themes;
- `problem-statement.md` — the framed problem (the PRD seed): acceptance criteria, scope,
  success metrics, owner;
- `business-case.md` — NPV / IRR, options, cost-benefit;
- `rfp/` — optional: RFI / RFP, evaluation scoring, selection;
- `decision-log.md` — go / no-go, kill decisions, sign-offs (four-eyes).

### Skills (the autonomous discovery loop — parallel to `next-story`)
- `discover` — gather-evidence iteration: runs the five Discover activities and writes *cited*
  evidence; never fabricates a source.
- `define` — synthesize evidence → themes → problem framing → business case → draft statement.
- `rfp` — optional build-vs-buy: produce the RFI / RFP, score responses, recommend.
- `seed-prd` — convert the agreed problem statement into a PRD seed plus `docs/backlog.yaml`
  entries that the delivery loop (`next-story`) can pick up.
- `discovery-loop` — the body of the autonomous discovery loop: pick the next eligible
  opportunity, run Discover → Define, surface the **go / no-go to the human** (this gate stays
  human), record blocked decisions and move on.

### Reviewer agents (pre-gate review, parallel to `contract-conformance` / `hard-stop`)
- `evidence-reviewer` — fails any claim without a cited source; checks people-centred coverage.
- `business-case-reviewer` — checks the case is complete (options, NPV / IRR, sensitivities)
  and not solution-led.
- `reg-risk-feasibility-reviewer` — discovery-mode regulatory & risk feasibility; no dead-end
  problems.

### Gates (block the hand-off, analogous to Q1–Q4.5)
- **D1 — evidence cited:** every claim sourced.
- **D2 — problem framed:** the problem statement is complete (problem, users, scope, success
  metrics, owner).
- **D3 — business case:** present and reviewed.
- **D4 — reg / risk feasibility:** signed off.
- **D5 — human gate:** investment / CEC committee approval + problem-statement sign-off
  (four-eyes; **this gate stays human**).

Only on all-pass does a discovery hand a PRD seed to delivery.

### Governance
A human control analogous to `HG-0001` (four-eyes merge): **investment / CEC approval is human;
kill decisions are recorded.** Map discovery to the institution's investment-approval and
model-risk controls (e.g. the `CPS-AI` set), and add a `HG-00xx` for it.

## 5. Starter backlog (seed items — `DISCOVERY-00..`)

Run these through the same autonomous loop once the canon exists.

- `DISCOVERY-00` — write `docs/DISCOVERY.md` (the canon) and the hand-off contract (the
  PRD-seed schema).
- `DISCOVERY-01` — `discovery/<slug>/` artifact templates (evidence, insights,
  problem-statement, business-case, decision-log).
- `DISCOVERY-02` — `discover` skill (cited-evidence gathering).
- `DISCOVERY-03` — `define` skill (synthesize → framing → business case → draft statement).
- `DISCOVERY-04` — `evidence-reviewer`, `business-case-reviewer`,
  `reg-risk-feasibility-reviewer` agents.
- `DISCOVERY-05` — discovery gates D1–D5 (CI checks where automatable; human gate D5).
- `DISCOVERY-06` — optional `rfp` skill + RFP scoring template.
- `DISCOVERY-07` — `seed-prd` skill: agreed problem statement → PRD seed + `docs/backlog.yaml`
  entries for delivery.
- `DISCOVERY-08` — `discovery-loop` skill + `docs/discovery-backlog.yaml`.
- `DISCOVERY-09` — governance control: investment-committee four-eyes + kill-log; map to entity
  controls.
- `DISCOVERY-10` — run one real opportunity end-to-end as the acceptance test (the discovery
  equivalent of "demoable on merge").

## 6. The hand-off contract (what a PRD seed must contain)

For delivery to accept it, the problem statement must yield enough to populate
`docs/PRD_Open_Finance_Back_Office.md` and `docs/backlog.yaml` so `next-story` can run:
a titled requirement set with acceptance criteria; scope (in / out, plus the neighbouring
exclusions); success metrics; a named owner; regulatory and risk notes; and — if applicable —
the selected partner and its constraints.

---

*Seed status: new / empty of discoveries. Commit this as the discovery canon, then run
`DISCOVERY-00..` through the autonomous loop to build the harness — exactly as the delivery
harness was built.*
