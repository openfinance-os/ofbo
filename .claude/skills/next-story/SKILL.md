---
name: next-story
description: Use as the body of the autonomous build loop (/loop /next-story) — picks the next eligible item from docs/backlog.yaml, implements it to the PRD's acceptance criteria, opens a PR for human merge on green gates (never self-merges — HG-0001), and never asks the user mid-iteration
---

# Next story — one autonomous build iteration

One invocation = one backlog item, end to end. The user is not a **mid-iteration** gatekeeper: **never ask them anything mid-iteration** — decisions they must make are recorded as `blocked` items and the loop moves on. They ARE the gatekeeper at the **end**: the loop opens a PR and stops for a human to merge (HG-0001), never self-merging.

## 1. Pick

Read `docs/backlog.yaml`. Choose the FIRST item (file order, milestone order) with `status: pending` whose `depends_on` are all `done`. Skip `blocked`/`deferred`.

**Waist gate (HG-0007).** A `BACKOFFICE-NN` feature item is only eligible if it carries a `discovery: <slug>` linking a gate-green `discovery/runs/<slug>/handoff.md` (or an explicit `discovery_exempt: true` + `reason:`). If the next pending feature has neither, do NOT build it: set it `blocked` with `reason: awaiting discovery hand-off (HG-0007)`, commit that to main, and move on — the feature needs the left diamond (discovery skill) and usually the Develop phase first. Infra (`M*-`) items are exempt. `scripts/discovery-link-check.mjs` enforces this in CI; honour it here so the loop never front-runs an unframed feature.

If nothing is eligible:
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

## 4. Merge policy — propose, never dispose (HG-0001)

The loop authors and verifies; a **human** merges. The agent never merges its own work — AI reviewing AI is not four-eyes for a regulated production change.

- Code/infra PR + CI green + both reviewers clean → push, open the PR, request review, and **STOP**. Notify the user that PR #N is ready for human merge (CI green, hard-stop PASS, conformance CONFORMANT). Do NOT merge; do NOT delete the branch. The item stays `in-progress` until a human merges it; its `depends_on` dependents wait — that back-pressure is intended.
- Spec PRs, ADRs, BD-decision changes → never merge; queue for the user (unchanged).

Branch protection on `main` (required human review from a CODEOWNERS group the agent isn't in, required Q1–Q4.5 + waist-gate checks, no self-approval) is the enforcement of record; this skill honours it so the loop doesn't depend on the agent's own restraint. The reviewer agents are a pre-merge screen, never the control of record.

## 5. Record + escalate

Append to `docs/build-log.md`: date, item, PR #, what the PR contains (it is **not** merged — a human disposes), test counts, reviewer verdicts, anything parked. Commit log/backlog blocker updates to main directly.

Push a notification on: (a) **a PR is ready for human merge** — the normal end of a successful iteration (PR #N, CI green, both reviewers PASS); (b) a milestone fully done; (c) the eligible queue is empty but blocked items need the user; (d) the same item failed its gates twice — park it `blocked` with the failure evidence after the second attempt; never thrash a third time.

## Red flags — stop and re-read this skill
- Asking the user a question mid-iteration ("should I…?") — record a blocker instead
- Merging ANY PR yourself — spec, ADR, feature, or infra. The loop proposes; a human merges (HG-0001)
- Marking `done` without reviewer verdicts and green CI in the log
- Starting a second backlog item in the same iteration
- Retrying a twice-failed item instead of parking it
