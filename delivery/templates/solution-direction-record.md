---
artifact: solution-direction-record
stage: develop
run: "<slug>"
handoff: "discovery/runs/<slug>/handoff.md"
---

# Solution direction — <slug>

> **Identifiers.** Gate ids (`D1`–`D9`, `Q1`–`Q5`) and run-level ids (`S-001` signal,
> `T-1` theme, `H1` hypothesis) are expanded in `discovery/GLOSSARY.md`.

> Develop (diverge, then converge). The right diamond's first half explores **N solution
> directions** and judges them; this record is the convergence. It is the boundary object
> between "we agreed the problem" and "we are building this" — written once per discovery
> hand-off, before the first backlog item is appended (HG-0009).

**Decided:** <YYYY-MM-DD> · **Owner:** <registry identity holding `solution-architect`>
**Inherited from:** `discovery/runs/<slug>/handoff.md` (D1 measures · D6 conditions)

## The directions explored

> At least three. A single direction dressed as a choice defeats the diamond — the point is
> that a real alternative was live at the moment of the decision.

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
| Institutional fit (BrainKit `architecture.md` · `technology-policy.json` incl. the `radar` ring each new technology sits in) | | | |

## The chosen direction

> What is being built, at the level of shape rather than spec: the components, the seams, the
> data that moves, the systems it touches.

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

> **Not here:** endpoints, schemas, and stories. Those are the backlog items this record
> unlocks — each appended with `discovery: <slug>` and `sdr:` pointing back here, so the waist
> gate can trace every story to the problem it serves.
