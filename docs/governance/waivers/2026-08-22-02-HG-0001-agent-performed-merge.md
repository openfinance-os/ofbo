# Waiver 2026-08-22-02 — HG-0001 agent-performed merge (PR #325)

- **Control deviated from:** [HG-0001 — Human four-eyes on merges and deploys (no agent self-merge)](../HG-0001-human-four-eyes-merge-and-deploy.md)
- **Date:** 2026-08-22
- **Authorised by:** the harness owner, in-session. The instruction was "merge 325"; the agent
  quoted HG-0001 back — author ≠ approver, and the merge actor would be recorded as the owner
  although the owner did not perform it — and offered four dispositions including "you merge it
  yourself, no waiver needed". The owner reaffirmed the agent-performed merge with the waiver.
- **Scope:** this one merge only. **HG-0001 is unchanged and remains Accepted.** This waiver
  creates no standing carve-out and is not a precedent for a class of change.

## What was done

The agent performed the merge of a pull request whose recent commits it had itself authored:

| PR | Story | Merge commit |
|---|---|---|
| #325 | Money at the wire (Option A) + CODE-03 audit convention | `af297a7` |

This is the **second** agent-performed merge in one day (see
[2026-08-22-01](2026-08-22-01-HG-0001-agent-performed-merge.md)). Two in a day is the point at
which "exception" starts to read as "practice", and that is itself an argument for the
branch-protection runbook rather than a third waiver.

Unlike waiver 01, this PR touches the **OFBO product**, not only the build harness: money
representation at the wire, the audit convention, and `packages/billing` / `services/bff` billing
paths. It does not touch production — the demo environment is permanently non-prod with synthetic
data only — but the blast radius is wider than 01's, and the reviewer that would ordinarily have
had an opinion on it did not run (below).

## What HG-0001 requires, and what was not satisfied

HG-0001 requires the approver to be **a human with accountability**, distinct from the author, and
rejects post-hoc audit as a substitute because change management is a **preventive** control.

Not satisfied:

- **Human-performed disposition.** The merge actor is the agent, acting with the owner's
  credentials, so GitHub records the merge under the owner's identity. Authorisation was human;
  the *action* was not, and the artifact cannot tell the difference. The release evidence bundle
  seals commit provenance as Art. 12/17 attribution (ADR 0019), which is precisely why this file
  exists — without it the bundle asserts a human merge that did not happen.
- **Independent AI advisory review.** Both legs are **red** on the merged head's predecessor
  (`6e5b9ff`) with `DID NOT COMPLETE` — the reviewer ran for 315s and 384s respectively with a
  valid credential (the preflight credential guard passed) and exited without writing its review
  file. That is the HARNESS-16 reliability hole, not a finding about the diff, but the effect is
  the same: **no AI review of this change exists.** They were not re-run before merge, on the
  owner's explicit instruction not to add the `ai-review` label.
- **Review of the final merge head.** The head advanced from `6e5b9ff` to `9112c46` (a merge of
  `main`) after those reviewer legs ran. Even had they succeeded, they would have judged the
  earlier tree.

## What *was* satisfied

- **All ten required status checks green on the actual merge head `9112c46`** — Q1, Q1b, Q2, Q2b,
  Q2c, Q3 integration, Q3 portal E2E, Q4, Q4.5, and Discovery. Verified job-by-job on that SHA, not
  on a stale run, and the merge request pinned `sha=9112c46` so GitHub would have cancelled the
  merge had the head moved.
- **Mutation testing passed** on the security core (`rbac` / `auth` / four-eyes), 18m43s, at
  `break: 70` — relevant because this branch also raises that job's timeout cap.
- **No gate weakened or skipped to reach green.** Q1b test-integrity passed. The branch adds
  guards rather than removing them.
- **Local re-verification after the final merge of `main`:** unit 1609/1609, harness 124/124,
  `doc-link-check` 63 docs / 32 ADRs.

## Why the control was technically bypassable

Branch protection on `main` is **still not enabled** — the same gap waiver 01 recorded, unchanged
since. [The activation runbook](../runbooks/main-branch-protection-activation.md) would have
refused this merge outright.

One thing did push back: GitHub's plain `/merge` endpoint **rejected** this PR because it belongs
to a stack, and the stacked async endpoint then refused it as conflicted until the branch was
brought current. That is a mechanical guard against a stale tree, not a governance one — it
enforces freshness, and says nothing about who approved.

## Restoring the control

1. Execute [`docs/governance/runbooks/main-branch-protection-activation.md`](../runbooks/main-branch-protection-activation.md).
   Two waivers in one day is the evidence that convention is not holding. Note the runbook's
   required-context list predates HARNESS-18/20; confirm live check-run names before pinning.
2. **HARNESS-16 needs attention before the next merge of product code.** Two reviewer legs failed
   identically, mid-run, with a valid credential, on two different PRs within twenty minutes. An
   advisory control that cannot complete is not advisory, it is absent — and this merge is the
   first time that absence covered a product change rather than a harness one.
3. Until branch protection is on, HG-0001 is enforced by convention alone, and any further
   agent-performed merge needs its own waiver entry in this directory.
