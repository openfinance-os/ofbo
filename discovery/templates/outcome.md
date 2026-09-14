---
artifact: outcome
stage: define
design_profile: discovery/brand/design.md
run: "<slug>"
outcome: stopped
decided_by: "<registry identity holding product-owner — a HUMAN; an agent may recommend, never dispose>"
decided_at: "<RFC 3339>"
reason: "<one or two sentences: which evidence refuted the framing, or why the problem is not worth solving now>"
evidence_ref: "research-log.md#S-<NNN>"
hypotheses:
  - id: H1
    verdict: refuted
  - id: H2
    verdict: uncertain
successor_run: ""
---

# Outcome — <slug>

> A discovery is **allowed to fail**: stopping the wrong problem early is a win, and it is recorded
> as an outcome, not hidden (canon §1). This file is that record. It exists only for a run that
> ended **without a hand-off** — a handed-off run is recorded by `handoff.md`, and the two never
> coexist. The front-matter is the record the harness reads: `core/loop-attestations.mjs` builds
> the `discovery-stopped` attestation from it (2.1.0, hardening plan 2.14) and refuses one with no
> reason, no hypothesis verdicts, or a non-human decider. `verdict` is one of
> refuted | confirmed | uncertain | not-tested; a stop that taught nothing about the framing
> hypotheses is a stop nobody can learn from.

## What was found

<Two or three sentences. Which framing hypotheses from `problem-statement.md` were refuted or
left uncertain, and by which signals (cite `S-NNN`). No solutioning — this is still the left
diamond.>

## What would reopen it

<The evidence that would make this problem worth a second run, or "nothing foreseen". If an
operations signal later routes here, its `reopened-discovery` attestation links to this run.>
