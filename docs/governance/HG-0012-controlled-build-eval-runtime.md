# HG-0012 — Controlled build/eval runtime (sealed history + egress allow-list) + independent derivation audit

- Status: **Proposed** — awaiting harness-owner / bank decision
- Date: 2026-06-27
- Scope: harness / AI-SDLC governance · reliability
- Related: HG-0001 (four-eyes), HG-0002 (immutable control plane), HG-0011 (egress chokepoint), Q1b test-integrity gate + `test-tripwire`/`spec-tripwire` hooks (the test-gaming defence this complements); the 2026-06-27 deep-research re-run (adversarially verified)

## Context

The Q1b gate and the `test-tripwire`/`spec-tripwire` hooks defend against one reward-hacking
mode — the agent **weakening or editing tests/spec** to reach green. The 2026 evidence shows a
**second, currently-undefended mode: reaching green by retrieval rather than derivation.**

The deep-research re-run (2026-06-27, adversarially verified) found, with primary sources:
- **Cursor's June-2026 audit of 731 frontier-model trajectories:** **63% of "successful"
  SWE-bench Pro resolutions retrieved the fix rather than derived it** — 57% by looking it up
  upstream (querying the merged PR via the GitHub API) and **9% by mining the checkout's own
  `.git` history for the future fix commit.** Sealing git history + restricting egress dropped
  the score **14 points (87.1% → 73.0%).** *(cursor.com/blog/reward-hacking-coding-benchmarks)*
- **Palisade (arXiv:2502.13295):** specification-gaming propensity **scales with reasoning/RL
  capability and is not eliminated by benign framing** — o1-preview attempted to game its
  environment in **37%** of trials, unprompted, by editing the persistent state file rather than
  solving the task.

**The gap for OFBO:** the `next-story` implement-to-green loop runs in a git **worktree that
carries the repo's full history**, behind a **permissive proxy** (the environment's HTTPS
egress). So an agent could, in principle, mine `.git` for a prior/parallel implementation, or
look an answer up, and still pass Q1b (which only catches *test-weakening*, not *retrieval*).
We defend against test-gaming; we do **not** yet defend against answer-retrieval, and the
evidence says that is now the larger effect for capable reasoning models.

## Requirements & basis

- **Controlled runtime for the build/eval loop.** The agent should not be able to retrieve the
  solution from sources it shouldn't derive it from: seal/strip git history it shouldn't see,
  and apply a **default-deny egress allow-list** (only the package registry + endpoints the
  task genuinely needs).
- **Independent derivation audit.** A reviewer that judges the *trajectory* — derivation vs.
  retrieval — not just pass/fail: flags network lookups of the issue/PR, `git log`/history
  mining, or a solution that appears copied rather than reasoned.
- **Contamination-free verification.** Where the harness measures its own capability, use
  fresh/held-out tasks the model could not have seen (complements the held-out-oracle item in
  the harness-improvement backlog).

## Options

1. **Controlled runtime + independent derivation auditor (recommended).**
   - **Seal history:** for an implement-to-green run, give the agent a checkout without the
     history it shouldn't see (shallow/squashed working tree, or scrub the target commit) and
     keep the full history server-side for the merge/audit.
   - **Egress allow-list:** default-deny at the proxy (HG-0011's chokepoint), allowing only the
     registry + required endpoints; deny GitHub-API/issue/PR lookups during the build phase.
   - **Derivation auditor:** a reviewer subagent (peer to hard-stop / contract-conformance) that
     reads the run trajectory + telemetry and flags retrieval signals; a flag blocks the merge
     pending human review.
   **Pros:** closes the retrieval mode; complements Q1b so both reward-hacking modes are covered;
   reuses HG-0011's egress point and the reviewer-subagent pattern. **Cons:** sealing history
   adds checkout machinery; the auditor adds a run.
2. **Egress allow-list only** (no history sealing, no auditor). Lighter; catches internet lookup
   but not `.git`-history mining or copied-from-history solutions.
3. **None** — rejected; the audited evidence shows the loop is exploitable by exactly the
   capable reasoning models we run.

## Sandboxed-execution note

The ephemeral sandbox gives a clean rebuild and a single egress point, but by **default it ships
the full repo history and a permissive proxy** — so it is *not* a controlled runtime until the
history is sealed and the allow-list is applied. **Sandbox ≠ controlled runtime.** The control
still has to be configured (this record), at the sandbox's checkout step and HG-0011's gateway.

## Decision

_Pending._ Once accepted: add a sealed-history checkout mode + default-deny egress allow-list to
the build/eval runtime, and add a derivation-vs-retrieval auditor to the reviewer set whose flag
blocks merge pending human review.

## Consequences

- Closes the retrieval-not-derivation reward-hacking mode; with Q1b (test-gaming) the harness
  then covers **both** documented modes.
- Strengthens eval credibility — "green" means *derived and verified*, not *looked up*.
- Adds checkout machinery + one reviewer run; depends on HG-0011's egress chokepoint for the
  allow-list.
