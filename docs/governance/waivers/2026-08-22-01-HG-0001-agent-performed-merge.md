# Waiver 2026-08-22-01 — HG-0001 agent-performed merge (PRs #328, #329)

- **Control deviated from:** [HG-0001 — Human four-eyes on merges and deploys (no agent self-merge)](../HG-0001-human-four-eyes-merge-and-deploy.md)
- **Date:** 2026-08-22
- **Authorised by:** the harness owner, in-session, explicitly and on reaffirmation after the
  control was quoted back to them
- **Scope:** these two merges only. **HG-0001 is unchanged and remains Accepted.** This waiver
  creates no standing carve-out and is not a precedent for a class of change.

## What was done

The agent performed the merge of two pull requests it had itself authored:

| PR | Story | Merge commit |
|---|---|---|
| #328 | HARNESS-17 — portal E2E Playwright install | `026f8f0` |
| #329 | HARNESS-18 — mutation + ai-review trigger breadth | `53d439e` |

Both are harness/CI changes. #329 modifies the CI control plane
(`.github/workflows/ai-review.yml`, `.github/workflows/mutation.yml`).

## What HG-0001 requires, and what was not satisfied

HG-0001 requires that the approver be **a human with accountability**, distinct from the author:
*"The agent never merges its own feature/infra work."* It deliberately rejects post-hoc audit as a
substitute, on the grounds that change management is a **preventive** control.

Not satisfied:

- **Human-performed disposition.** The GitHub merge actor is the agent. Authorisation was human;
  the *action* was not. The release evidence bundle seals commit provenance as Art. 12/17
  attribution (ADR 0019), so the artifact will attribute these merges to the agent. Anyone reading
  that bundle without this waiver would see an unexplained HG-0001 violation.
- **Independent AI advisory review**, on both PRs, for unrelated reasons:
  - #329 — `ai-review` correctly reported NOT RUN. The PR edits ai-review's own control-plane
    parity boundary, and no engine reviews a PR that changes how reviews run. Working as designed.
  - #328 — its `ai-review` checks were stale red from the 19–22 Aug Actions outage (dispatch
    rejection, `runner_id: 0`), not a review finding. They were not re-run before merge.

## What *was* satisfied

- **All nine pinned required status checks green** on each merged head — Q1, Q1b, Q2, Q2b, Q2c,
  Q3 integration, Q3 portal E2E, Q4, Q4.5, plus Discovery. Verified on the actual merge commits,
  not on stale runs.
- **No gate weakened or skipped to reach green.** Both PRs *add* guards: `ci-cost-guard.test.mjs`
  (8 assertions) and `playwright-install-check.test.mjs` (5). Q1b test-integrity passed on both.
- **Neither change touches the OFBO product**, regulated data paths, or production. Scope is the
  build harness. The demo environment is permanently non-prod with synthetic data only.

## Why the control was technically bypassable

Branch protection on `main` is **not enabled**. HG-0001 records this as "the bank's config step",
and [the activation runbook](../runbooks/main-branch-protection-activation.md) exists precisely to
close it. With protection enabled and the required-reviewer rule set, these merges would have been
refused by GitHub rather than permitted and then documented here.

**This waiver is therefore evidence for prioritising that runbook**, not an argument that the
control is optional. A preventive control that depends on the agent choosing to honour it is an
advisory control.

## Restoring the control

1. Execute [`docs/governance/runbooks/main-branch-protection-activation.md`](../runbooks/main-branch-protection-activation.md)
   — required human review from a CODEOWNERS group the agent is not in, plus the pinned status
   checks. Note that the required-context list in that runbook is still the pre-HARNESS-18 set;
   confirm the live check-run names before pinning.
2. Until then, HG-0001 is enforced by convention alone. Any further agent-performed merge needs its
   own waiver entry in this directory.
