---
artifact: adr
stage: deliver
id: "ADR-<NNNN>"
change: "<CHG-…>"
story: "<backlog item id>"
---

# ADR-<NNNN> — <decision, stated as a choice made>

> **Identifiers.** Gate ids (`D1`–`D9`, `Q1`–`Q5`) and run-level ids (`S-001` signal,
> `T-1` theme, `H1` hypothesis) are expanded in `discovery/GLOSSARY.md`.

> Deliver. An architecture decision the build loop may **not** make for itself. The loop drafts
> this record, sets the story `blocked` with its path, and stops; a human with architecture
> authority decides and merges. An ADR is never self-merged by the agent (HG-0001), and a
> `proposed` ADR unblocks nothing.

**Status:** proposed · **Date:** <YYYY-MM-DD>
**Deciders:** <registry identity ids holding `solution-architect` / `enterprise-architect`>
**Drafted by:** <agent identity — drafting is not deciding>

## Context

> What forces the decision now: the story that hit it, the constraint that bites, the option
> that was assumed and turned out not to hold. Name the inherited boundaries — the discovery
> hand-off's D6 conditions, the BrainKit's `technology-policy.json`, the contract the spec
> tripwire protects. One paragraph, no options yet.

## Options considered

> At least two real options, each argued fairly. An option nobody could choose is not an option;
> a straw man makes the record worthless to the next reader.

### Option A — <name>

- **What it is:**
- **Costs:**
- **Risks:**

### Option B — <name>

- **What it is:**
- **Costs:**
- **Risks:**

## Decision

> **Chosen: Option <X>.** Then the reasoning — why this option beats the others *against the
> success measures and the inherited conditions*, not in the abstract.

## Consequences

- **Becomes true:**
- **Becomes harder:**
- **Revisit when:** <the condition or date that reopens this>

## Compliance notes

> Which HG entries, gates, controls, or regulatory expectations this touches — and how the
> decision leaves each one. If it touches none, say **none** rather than leaving the section
> empty: silence reads as an omission, not as a clean bill.

| Control / gate | How this decision affects it |
|---|---|
| | |

> **Not here:** implementation detail that belongs in the spec, and status updates that belong
> in the backlog. An ADR records *the decision and why*, so a reader two years out can tell
> whether the reasoning still holds.
