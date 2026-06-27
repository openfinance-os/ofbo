# HG-0010 — Immediate cease-use kill-switch + Autonomous Systems Officer

- Status: **Proposed** — awaiting bank risk-governance decision
- Date: 2026-06-27
- Scope: harness / AI-SDLC governance
- Related: HG-0006 (the model-risk umbrella that requires controllability), HG-0002 (control plane), HG-0005 (prod gate), HG-0003 (the processing register the ASO owns); the 2026-06-27 UAE regulated-banking harness assessment

## Context

The CBUAE *Guidance Note on the Responsible Adoption and Use of AI/ML (2026)* requires every
Licensed Financial Institution to maintain a **direct capability to cease the use of any AI
model immediately**, and to name an accountable owner for the autonomous system (the DIFC
*Consultation Paper No. 3 of 2026* amendment to Regulation 10 makes the **Autonomous Systems
Officer (ASO)** explicit for high-risk deployments). The OFBO harness today has no enterprise
cessation control: a human can interrupt a single run, but there is no **master switch** that
blocks all subsequent agent requests and terminates active sessions across the enterprise, and
no named role accountable for pulling it.

## Requirements & regulatory basis

- **Immediate cease-use (CBUAE, mandatory).** A single action that halts the loop everywhere:
  blocks new agent/LLM requests, terminates in-flight sessions, and disables the hooks/skills
  from running unattended — independent of the agent.
- **Named accountability (DIFC Reg 10 / CP3).** An **Autonomous Systems Officer** (with the
  Board Risk Committee) owns the switch and the AI-processing register (HG-0003).
- **Auditability.** Every cessation (who, when, why, scope) is recorded in the immutable
  register; re-enablement is itself a human-approved change.

## Options

1. **Gateway-enforced master cessation (recommended).**
   Put cessation at the egress chokepoint (the onshore model gateway, HG-0011): a single
   control flips a cache flag that fails-closed on every subsequent agent request, while a
   session reaper terminates active ephemeral sandboxes and revokes their proxy tokens.
   The ASO and Board Risk Committee hold the trigger; re-enable requires a separate human
   approval. **Pros:** one enforcement point, fails closed, terminates in-flight work.
   **Cons:** depends on HG-0011's gateway existing (enterprise infra).
2. **Repo/CI-level disable** (e.g., a required "kill" check that hard-fails all pipelines, plus
   revoking the agent's identity). **Pros:** available before the gateway exists; good interim.
   **Cons:** stops *merges/deploys*, not necessarily an in-flight local run.
3. **Policy-only** ("an admin will stop it"). **Rejected** — not a control; not the
   "direct capability" the regulator requires.

## Recommendation

**Option 1** for the enterprise profile (gateway-enforced), with **Option 2 as the interim**
control until the onshore gateway (HG-0011) is built.

## Sandboxed-execution note

Running the harness as **isolated, ephemeral cloud agents** (no developer laptop) makes the
*mechanics* of cessation easier, not redundant: "terminate active sessions" becomes "kill the
containers and revoke their proxy tokens," which is clean and immediate. But the **decision
authority and enforcement point still have to exist** — sandboxing gives you a kill target, not
a kill-switch. The switch and the ASO role are still required.

## Decision

_Pending (bank)._ Once accepted: implement the cessation flag at the gateway (or the interim
CI/identity disable), assign the ASO + Board Risk Committee as triggers, log every cessation to
the HG-0003 register, and make re-enablement a human-approved change.

## Consequences

- Satisfies the CBUAE mandatory cease-use expectation and the DIFC named-owner expectation.
- Gives HG-0006 its "controllability" leg and HG-0003 its accountable owner.
- Adds an operational role (ASO) and a tested cessation runbook as a precondition for
  unattended operation.
