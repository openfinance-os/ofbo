---
artifact: solution-direction-flow
catalog: B
write_class: decision-routed
mirrors: delivery/templates/solution-direction-record.md
floor_only: Flow state
stage: develop
---

# Solution direction flow — <slug>

> ## 🔀 WRITE CLASS · `decision-routed` — WRITTEN HERE, DECIDED IN GIT
>
> This flow is where a solution direction gets **converged**. It is not where it becomes the record.
> What you write here is a draft of `delivery/templates/solution-direction-record.md` — the git
> artifact this flow mirrors, section for section — and no gate reads this page.
>
> **The steps of this flow ARE the record's sections, in the record's order.** One step per section:
> the directions explored, the judgment, the chosen direction, the measures, the inherited
> conditions, the ADRs deferred. That is deliberate. A flow with its own stages would let a step be
> reordered, merged or skipped without anyone noticing that the artifact it produces is no longer the
> artifact the D-gates read. `scripts/approval-surface-check.mjs` refuses a flow that has drifted
> from the template it mirrors.
>
> **How it becomes real.** A floor-keeper carries the completed flow into the repository as a
> **signed envelope** (`core/approval-attestations.mjs`) and **a human merges** the pull request.
> Until that merge no backlog item may be appended against this direction (HG-0009): the record is
> the boundary object between "we agreed the problem" and "we are building this", and a draft on the
> floor is not a boundary.
>
> **NON-AUTHORITATIVE · DECLARED, NOT ACTIVE.** WS5's entry gate has not passed: it needs an
> independent second-line review of the workstream's design, and that review does not exist. Nothing
> on this page approves, unlocks or evidences anything.

## Flow state

> Floor-only — this block never travels into `discovery/runs/` or `docs/`. It is the *flow* half of
> the page: which step is live, who is waiting, and what would move it. Roles, never names.

- **Step now live:** <1–6, matching the sections below>
- **Discovery hand-off inherited from:** `discovery/runs/<slug>/handoff.md`
- **Owner (role):** `solution-architect`
- **Waiting on (role):** <role, or "nothing — ready to route">
- **Blocked by:** <ADR id, open question, or "nothing">
- **Routed as envelope on:** <YYYY-MM-DD, or "not yet routed">

## The directions explored

> At least three. A single direction dressed as a choice defeats the diamond — the point is that a
> real alternative was live at the moment of the decision. Fill this in *before* the judgment step:
> a flow filled backwards from the answer produces three directions, one of which was ever real.

| # | Direction | Shape in one line | Sketch (`/design` canvas, if it has a surface) | Killed by / survived because |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

## The judgment

> How the directions were scored — against the D1 success measures and the inherited D6
> data-governance conditions, not against taste. Name the criterion that actually decided it.

| Criterion (source) | Dir 1 | Dir 2 | Dir 3 |
|---|---|---|---|
| <measure from D1> | | | |
| <condition from D6> | | | |
| Institutional fit (BrainKit `architecture.md` · `technology-policy.json`) | | | |

## The chosen direction

> What is being built, at the level of shape rather than spec: the components, the seams, the data
> that moves, the systems it touches.

## How it meets every success measure

| D1 measure | How this direction meets it | How it will be evidenced |
|---|---|---|
| | | |

## Inherited conditions carried into delivery

> Every D6 condition and every constraint from the hand-off, restated as something delivery must
> honour — each one traceable to a backlog item or an explicit control.

| Condition (source) | Carried into |
|---|---|
| | |

## Decisions deferred to ADRs

| Question | ADR | Blocking? |
|---|---|---|
| | `docs/adrs/ADR-<NNNN>.md` | |

> **Not here:** endpoints, schemas, and stories. Those are the backlog items this record unlocks —
> each appended with `discovery: <slug>` and `sdr:` pointing back here, once the envelope has
> merged.
