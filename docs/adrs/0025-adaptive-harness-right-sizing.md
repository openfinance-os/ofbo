# ADR 0025 — Adaptive harness right-sizing: capability-compensating scaffolding vs. fixed accountability controls (HARNESS-05)

- Status: **Accepted** — chosen by the user (2026-06-28)
- Date: 2026-06-28
- Scope: the harness's own machinery and how it evolves over time — a meta-principle, not a
  product feature. Like ADR 0019, CLAUDE.md rule 6 (compose, don't invent new *process*
  primitives) applies; this ADR adds the temporal corollary — also *prune* the machinery that
  rising model capability makes redundant, and never prune the machinery that capability was
  never the reason for.

## Context

OFBO is built by an autonomous agent loop against a deliberately heavy harness: worktree
isolation, PreToolUse tripwires, clean-context reviewer subagents, deterministic gates
(D1–D9, Q1–Q4.5), a contract self-correction loop, and a sealed release-evidence bundle
(ADR 0019). Much of that machinery exists to compensate for the *present-day* limits of the
models and tools driving the loop.

Frontier LLM capability and agent harnesses are advancing quickly toward longer autonomous
loops, self-sustaining operation, and less human intervention. Two failure modes follow, and
they pull in opposite directions:

- **Over-engineering.** We keep hardening scaffolding that the next model generation makes
  pointless — paying in maintenance, drift, and reviewer load for controls that no longer earn
  their keep. "What was difficult once will not be difficult in the future" — so building for
  today's difficulty permanently is a mistake.
- **Under-regulating.** The same capability narrative ("the model is good enough now") gets
  used to justify removing controls that were *never* about model capability — they exist
  because a legal entity must own a decision. Retiring those on a capability argument is a
  category error that deregulates a regulated build.

The harness therefore needs a durable, fast test to tell these two kinds of machinery apart,
and a cadence to act on it — without that test itself becoming heavyweight bookkeeping.

## Decision

Classify every harness control into exactly one of two buckets, and treat them oppositely
over time.

### Bucket A — capability-compensating scaffolding

Exists *only* to compensate for current model/tool weakness. Examples: the verbose
tests-first ceremony, fine-grained deterministic gates, hand-holding scripts, retry/iteration
loops, worktree babysitting, the contract self-correction loop (ADR 0019 HARNESS-02).

Each Bucket-A control carries a one-line **sunset hypothesis**: *"this exists to compensate
for X; revisit when capability covers X."* On the review trigger below, a Bucket-A control
that no longer earns its keep is **pruned, not preserved**. Bias replacements toward low-code
/ declarative configuration over bespoke scripts, and toward longer resumable, idempotent
unattended runs.

### Bucket B — accountability controls

Exist because a legal entity must *own a decision*, independent of how capable the machine is.
Examples: four-eyes merge (HG-0001), the INSERT-only immutable audit, the persona scope matrix,
PSU consent, UAE data residency, the production gate (HG-0005 / Q5), agent build provenance
(ADR 0019 HARNESS-03).

These are **fixed points**. Capability gains do not retire them; *"what was hard once won't be
hard"* does not apply, because difficulty was never their rationale — accountability was. If
anything, longer unattended loops *raise* their importance, because more happens between each
human touch.

### Corollary — autonomy grows *between* the gates, never *through* them

The harness should keep extending how much it does unattended — longer loops, declarative
config over bespoke scripts, resumable/idempotent jobs. That additional autonomy is spent
buying longer self-driving stretches *between* human decision points. It is **never** spent
removing the decision points themselves. The Bucket-B gates stay exactly where they are while
everything around them gets more autonomous.

### Review trigger

On each adopted frontier-model upgrade (or a periodic harness retro), re-evaluate Bucket-A
controls against their sunset hypotheses and prune what no longer pays for itself. Bucket-B
controls are **out of scope** for removal by this review.

## Consequences

- Future sessions (human or agent) get an explicit, fast classification test to apply *before*
  adding or keeping harness machinery — an anti-over-engineering tripwire at the *design* level,
  complementing ADR 0019's anti-reward-hacking tripwire at the *execution* level.
- It blocks the symmetric error: deregulating an accountability control under a capability
  argument. The two buckets make "the model is good enough now" a valid reason to retire a
  Bucket-A control and an invalid reason to touch a Bucket-B one.
- **No new gate, hook, script, or other machinery is created.** The principle *is* the
  deliverable — over-building it would contradict it. Tagging each existing control with its
  bucket is explicitly deferred (see follow-ups).
- Extends CLAUDE.md rule 6 ("compose, don't invent new platform/process primitives") with its
  temporal half: also retire primitives that capability has made redundant.

## Follow-ups (not in this change)

- **HARNESS-06 — per-control bucket + sunset annotations.** Optionally annotate existing
  gates/hooks/scripts with their bucket and (for Bucket A) a sunset hypothesis, giving the
  review trigger a concrete worklist. Deferred deliberately: this is exactly the kind of
  bookkeeping that improving capability will make cheap to generate on demand, so doing it
  now risks the over-engineering this ADR warns against. Captured as backlog HARNESS-06 (pending).

## Alternatives considered

- **Tag every control now (the larger option).** Deferred as HARNESS-06 above — the annotations
  are most cheaply produced later, and producing them now is premature scaffolding.
- **Leave the principle implicit / internalized only.** Rejected as the *record*: a principle
  that governs *removing* machinery from a regulated build must be as explicit and auditable as
  the one that governs *adding* it (ADR 0019), or it will not survive author turnover — human or
  model.
- **Capability-indexed auto-sunset (controls expire on a timer).** Rejected — automatic expiry
  of a control is itself an accountability risk. Removal of any control must be a *reviewed*
  decision, never a timer firing unattended.
