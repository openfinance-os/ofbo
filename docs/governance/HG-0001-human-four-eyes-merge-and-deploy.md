# HG-0001 — Human four-eyes on merges and deploys (no agent self-merge)

- Status: **Accepted** (Option 1; harness-owner direction, 2026-06-25) — production branch
  protection + CODEOWNERS remain the bank's config step (see Decision)
- Date: 2026-06-20 (proposed) · 2026-06-25 (accepted)
- Scope: harness / AI-SDLC governance (not the OFBO product)
- Related: HG-0002 (immutable control plane), HG-0005 (prod gate); the harness bank-readiness review (2026-06-20)

## Context

The autonomous build loop currently **authors a change, has it reviewed by its own AI
subagents (hard-stop-reviewer, contract-conformance-reviewer), and then merges the PR
itself** on green gates ("merge it yourself" — next-story skill). Deploys then fire
automatically on merge. Observed this session: code PRs were self-merged with no human
in the loop; the only "approval" was AI reviewing AI.

A CBUAE-regulated bank runs production change under **change management + separation of
duties**: a change is proposed by one party and approved by a *different, accountable
human* (four-eyes), typically via a change record / CAB for production. An AI approving
its own AI's work satisfies neither SoD nor human accountability. This is the single
most important harness control gap.

## Requirements & regulatory basis

- **Separation of duties.** Author ≠ approver; the approver must be a human with
  accountability. The agent is the author; it cannot also be the approver.
- **Change management (CBUAE / standard banking IT controls).** Production-affecting
  changes need recorded human approval (and, for prod, a CAB/release approval).
- **Auditability.** Each merge/deploy must name the approving human and the change record.
- **AI review is an aid, not a control of record** — useful, but not a substitute for human sign-off.

## Options

1. **Enforced branch protection: required human review + required status checks, no self-merge (recommended).**
   On the protected branch (main): require ≥1 (prod-affecting: ≥2) **human** approvals
   from a CODEOWNERS group the agent is not in, require all CI gates (Q1–Q4.5) green,
   disallow self-approval, and gate prod deploy behind a separate human environment
   approval (HG-0005). The agent's role ends at "open PR + pass gates + request review."
   AI reviewers remain as *advisory* PR checks. **Pros:** real SoD + human accountability;
   uses native GitHub/org controls outside the agent's reach. **Cons:** removes the
   fully-autonomous merge — by design.
2. **Human approval only for prod / control-plane changes; auto-merge low-risk code.**
   Risk-tiered. **Pros:** keeps velocity on trivia. **Cons:** the agent (or its risk
   classifier) decides what's "low-risk" — a self-judged carve-out a bank will distrust;
   weaker SoD.
3. **Keep AI-self-merge, add post-hoc human audit.** Detect-not-prevent. **Rejected** —
   change management is a preventive control; post-hoc audit of unapproved prod changes
   is a finding, not a control.

## Recommendation

**Option 1.** Branch protection with required human review (no self-merge/approve) +
required gates, prod behind a human environment gate. AI review stays advisory.

## Decision

**Accepted — Option 1 (harness-owner, 2026-06-25).** The loop authors and verifies; a **human**
disposes. The agent never merges its own feature/infra work — AI reviewing AI is not four-eyes
for a regulated production change.

Implemented in the harness now:
- **The `next-story` loop stops at "PR opened, gates green, both reviewers PASS, review
  requested"** and notifies the user that the PR is ready for human merge — it does **not** merge
  or delete the branch. The item stays `in-progress` until a human merges; dependents wait on it
  (intended back-pressure). Spec PRs / ADRs / BD-decisions were already human-only.

Remaining bank-config step (enforcement of record, outside the agent's write scope — HG-0002):
- **Branch protection on `main`** — required human approval from a **CODEOWNERS** group the agent
  is not in, required status checks (Q1–Q4.5 + the discovery/waist gate), no self-approval; prod
  deploy behind a separate human environment gate (HG-0005). No CODEOWNERS file exists yet; the
  human reviewer group is the bank's to name. The skill honours the policy so the loop doesn't
  rely on the agent's own restraint, but native branch protection is what makes it non-bypassable.

## Consequences

- Ends autonomous merge-to-main; the loop becomes "propose + verify," humans dispose.
- Requires a named human reviewer group and a change-record convention (HG-0003).
- Must be enforced *outside* the agent's write scope (HG-0002), or the agent could relax it.
