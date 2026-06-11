---
name: next-story
description: Use as the body of the autonomous build loop (/loop /next-story) — picks the next eligible item from docs/backlog.yaml, implements it to the PRD's acceptance criteria, merges on green gates, and never asks the user mid-iteration
---

# Next story — one autonomous build iteration

One invocation = one backlog item, end to end. The user is an auditor of `docs/build-log.md`, not a gatekeeper: **never ask them anything mid-iteration.** Decisions they must make are recorded as `blocked` items, and the loop moves on.

## 1. Pick

Read `docs/backlog.yaml`. Choose the FIRST item (file order, milestone order) with `status: pending` whose `depends_on` are all `done`. Skip `blocked`/`deferred`. If nothing is eligible:
- if blocked items exist → send a push notification listing the human decisions needed, log it, and end the iteration;
- if everything is done → notify milestone/backlog completion and end.

## 2. Implement

Branch `feature/BACKOFFICE-NN-<slug>` (infra items: `feature/m1-<slug>`). Set the item `in-progress` in the backlog **on the branch** (it rides the PR).

- `BACKOFFICE-NN` items: follow the `implement-story` skill exactly (canon read → failing contract tests shown red in the log → implement to green → DoD). Flip the route's `[contract-pending]` `it.fails` entries to real contract tests as part of the story.
- Infra items (`M*-…`): the acceptance criteria are the milestone exit criteria in PRD §9 — encode them as executable tests (Playwright/integration) in the same change.
- Mark the item `done` in the backlog in the final commit of the branch.

**Spec conflict found mid-story** → run the `spec-change` skill: open the spec-only PR but DO NOT merge it (contract changes are human-approved, always); set the story `blocked` with `reason: awaiting spec PR #N`, commit that to main, and start the next iteration item.

**Genuinely uncovered gap** (new primitive needed) → write the ADR in `docs/adrs/`, set the item `blocked` with the ADR path, move on. Humans decide.

## 3. Verify — every gate, evidence in the log

1. `pnpm gen && pnpm lint && pnpm typecheck && pnpm test` green; integration suite green against local Postgres; coverage ≥80% on changed packages.
2. Dispatch BOTH reviewer subagents on the diff: `hard-stop-reviewer` must return `VERDICT: PASS`; `contract-conformance-reviewer` must return `VERDICT: CONFORMANT`. A FAIL is fixed and re-reviewed — never argued away.
3. Push, open the PR (cite the BACKOFFICE-ID), wait for CI gates Q1–Q3.

## 4. Merge policy

- Code/infra PR + CI green + both reviewers clean → **merge it yourself** (merge commit), delete the branch. The reviewer agents are the second pair of eyes; the implementing context never self-certifies.
- Spec PRs, ADRs, BD-decision changes → never merge; queue for the user.

## 5. Record + escalate

Append to `docs/build-log.md`: date, item, PR #, what merged, test counts, reviewer verdicts, anything parked. Commit log/backlog blocker updates to main directly.

Push a notification ONLY on: (a) a milestone fully done, (b) the eligible queue is empty but blocked items need the user, (c) the same item failed its gates twice — park it `blocked` with the failure evidence after the second attempt; never thrash a third time.

## Red flags — stop and re-read this skill
- Asking the user a question mid-iteration ("should I…?") — record a blocker instead
- Merging a spec PR or ADR yourself
- Marking `done` without reviewer verdicts and green CI in the log
- Starting a second backlog item in the same iteration
- Retrying a twice-failed item instead of parking it
