# HG-0009 — Develop diverges before delivery converges (the right-diamond diverge)

- Status: **Accepted** (harness-owner direction, 2026-06-25)
- Date: 2026-06-25
- Scope: harness / AI-SDLC governance — the `develop` skill (`.claude/skills/develop/`)
- Related: HG-0007 (discovery precedes delivery — the waist this phase feeds across);
  `discovery/DISCOVERY.md` (the Double Diamond); `CLAUDE.md` (compose-don't-invent, hard-stops);
  ADR process (new primitives) and the `spec-change` skill (contract changes are human-approved).

## Context

The Double Diamond's right half is **Develop (diverge) → Deliver (converge)**. The delivery loop
(`next-story`) is an excellent *Deliver*: it builds ONE thing right. But the harness had no
*Develop* — the loop went straight from a backlog item to a single implementation, with no
exploration of competing solution directions. The first idea won by default. The hand-off even
emitted "Open questions for Develop" that nothing consumed. The second diamond was a straight
line, not a diamond — and the place where parallel AI exploration is most valuable (generate
several directions, judge, converge) was empty.

## Requirements & regulatory basis

- **Solution exploration is a first-class step.** A delivered feature should be the *chosen* of
  several considered directions, with the choice recorded — not the first thing implemented.
  (Auditability of design decisions; the SDR extends BCBS 239 "why was this built" lineage.)
- **Problem/solution separation preserved.** Develop sits in the RIGHT diamond: it may reason
  about mechanism (the left-diamond no-solutioning boundary D4 does not apply to it), but it stops
  at a chosen direction + backlog item — it does not write code or author the contract.
- **Compose, don't invent.** A direction needing a new platform primitive or a contract change
  must surface it as an ADR / `spec-change` PR — human-approved, never self-merged — exactly as in
  delivery. Develop proposes; humans ratify the spec; the delivery loop builds.
- **Constraints inherited, not rediscovered.** The chosen direction must satisfy the hand-off's
  success measures AND the data-governance conditions D6 handed across AND the OFBO hard-stops.

## Decision

A discovery hand-off is consumed by the **Develop** phase (the `develop` skill), which explores
≥3 solution directions in parallel (AI fan-out), judges them against the success measures +
inherited D6 conditions + hard-stops, converges on one, records a **Solution Direction Record**
(`docs/develop/<slug>.md`), and appends the discovery-linked backlog item(s) the delivery loop
then picks up. Develop authors no code and touches no spec.

This composes with HG-0007: Develop is what normally produces the `discovery: <slug>`-linked
backlog item, so the waist gate is satisfied by construction rather than by hand.

## Consequences

- A feature's *direction* (and the alternatives weighed) becomes a first-class, audited artifact
  between the problem (hand-off) and the build (delivery), via the SDR.
- The right diamond is now a diamond: diverge (Develop) → converge (Deliver), not a single line.
- The AI fan-out lives where it pays most — exploring solution space — while the existing
  human-approved gates (ADR, `spec-change`, the delivery reviewers) still own anything that
  changes a primitive, the contract, or production.
