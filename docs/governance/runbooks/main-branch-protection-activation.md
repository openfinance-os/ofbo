# Runbook — Activate human-merge enforcement on `main` (HG-0001 / HG-0002 / HG-0004)

**Audience:** a GitHub **org/repo admin** for `openfinance-os/ofbo`.
**Why this exists:** HG-0001 (no agent self-merge) and HG-0002 (immutable control plane)
are *Accepted*, the `.github/CODEOWNERS` file is in place, and the `next-story` loop already
stops at "PR ready for human merge." **But the enforcement is currently inert** — so an
agent identity can still merge to `main`. This runbook turns on the native GitHub controls
that make the policy non-bypassable. None of these steps are in the agent's write scope by
design (that is the point of HG-0002).

## Observed gap (2026-06-27)

An agent-driven session merged PRs #277 and #278 to `main` directly. Root cause — three
independent reasons the control did not bite, all fixable below:

1. **CODEOWNERS handles are placeholders.** `@openfinance-os/ofbo-maintainers` and
   `@openfinance-os/control-plane-owners` do not exist as teams, so GitHub treats them as
   unknown owners and "require Code Owner review" cannot be satisfied or enforced.
2. **Branch protection on `main` is not enabled** (or does not require Code Owner review /
   does allow bypass). Without it, CODEOWNERS is advisory only.
3. **The agent operates as a human admin identity.** The session acted as `michartmann`
   (a repo admin), not a least-privilege machine identity — so even with protection on,
   an admin bypass or admin merge rights would defeat it (HG-0004). The durable fix is a
   separate, least-privilege agent identity that is **not** in the owner teams and **cannot**
   merge or bypass.

Fixing **any one** raises the bar; do **all three** for defence in depth.

---

## Step 1 — Create the two human teams (HG-0001 / HG-0002)

Create both teams under the `openfinance-os` org with **accountable humans**. The build
agent / bot identity **must not** be a member of either, and must not be able to approve its
own PRs.

| Team | Purpose | Used by CODEOWNERS for |
|---|---|---|
| `ofbo-maintainers` | baseline human reviewers | everything (`*`) |
| `control-plane-owners` | control-plane change approvers | `.github/`, `.claude/`, `CLAUDE.md`, `scripts/`, `docs/governance/`, `specs/`, `docs/adrs/` |

```bash
# replace SLUGS only if your org uses different names (then update .github/CODEOWNERS to match)
gh api -X PUT  /orgs/openfinance-os/teams/ofbo-maintainers/memberships/<human-login> -f role=member
gh api -X PUT  /orgs/openfinance-os/teams/control-plane-owners/memberships/<human-login> -f role=member
```

> **Interim option (binds today, before teams are formalised):** point the CODEOWNERS
> catch-all at a real human instead of a non-existent team, e.g. `*  @michartmann`. This
> makes "require Code Owner review" resolvable immediately. Treat as a stopgap — teams are
> the maintainable answer. Editing `.github/CODEOWNERS` is itself a control-plane change and
> should be merged under the protection this runbook establishes.

## Step 2 — Confirm the exact required status-check contexts

The required-check **contexts** are the CI job names. As of this writing they are:

```
Q1 — build + unit
Q1b — test integrity (anti-reward-hacking)
Q2 — static analysis + SAST
Q2b — documentation integrity (anti-drift)
Q3 — integration + contract
Q3 — portal E2E (Playwright)
Q4 — security review + dependency scan
Q4.5 — BCBS 239 lineage validation
Discovery — D1–D9 gates + waist + harness tests
```

Verify the live names before pinning them (they must match exactly):

```bash
gh api /repos/openfinance-os/ofbo/commits/main/check-runs --jq '.check_runs[].name' | sort -u
```

## Step 3 — Enable branch protection on `main` (HG-0001)

```bash
gh api -X PUT /repos/openfinance-os/ofbo/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Q1 — build + unit",
      "Q1b — test integrity (anti-reward-hacking)",
      "Q2 — static analysis + SAST",
      "Q2b — documentation integrity (anti-drift)",
      "Q3 — integration + contract",
      "Q3 — portal E2E (Playwright)",
      "Q4 — security review + dependency scan",
      "Q4.5 — BCBS 239 lineage validation",
      "Discovery — D1–D9 gates + waist + harness tests"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "required_approving_review_count": 1,
    "require_last_push_approval": true
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON
```

Why these settings:
- **`require_code_owner_reviews: true`** + **`required_approving_review_count: 1`** — a human
  in a CODEOWNERS team must approve. The agent (author) cannot self-approve.
- **`require_last_push_approval: true`** — an approval is invalidated by a later agent push,
  so the human approves the *final* diff (closes the "approve then push more" gap).
- **`enforce_admins: true`** — "Do not allow bypass," including admins. This is what would
  have stopped the 2026-06-27 admin-identity merge.
- **`strict: true`** — branch must be up to date with `main` before merge.
- **`required_conversation_resolution: true`** — review threads must be resolved.

> **Control-plane & production changes (HG-0001 / HG-0005):** raise
> `required_approving_review_count` to **2** for stricter assurance, and keep production
> deploys behind a **separate human environment gate** (GitHub Environments → required
> reviewers on the `production` environment). CODEOWNERS already routes `.github/`, `.claude/`,
> `CLAUDE.md`, `scripts/`, `docs/governance/`, `specs/`, `docs/adrs/` to `control-plane-owners`.

## Step 4 — Give the agent a least-privilege identity (HG-0004)

So the next agent `merge` is *refused*, not merely *declined by the agent's own restraint*:

1. Run the build loop under a **dedicated machine identity** (GitHub App installation token or
   a machine user) — **not** a human admin PAT. The PR `user` should be that identity, not a person.
2. Grant it only: `contents:write` (push branches), `pull_requests:write` (open PRs),
   `checks:read`/`statuses:read`. **No** `administration`, **no** merge via admin bypass.
3. Ensure that identity is **not** a member of `ofbo-maintainers` or `control-plane-owners`.
4. Optionally add an org/repo ruleset restricting who may merge to `main` to the human teams.

With Steps 1–4 done, an agent-initiated merge to `main` returns a GitHub error
(`Required status check ... / At least 1 approving review by a code owner is required`)
instead of succeeding.

## Step 5 — Verify the control is live

```bash
# 1. Protection is on and requires code-owner review + no bypass
gh api /repos/openfinance-os/ofbo/branches/main/protection \
  --jq '{checks: .required_status_checks.contexts, code_owners: .required_pull_request_reviews.require_code_owner_reviews, enforce_admins: .enforce_admins.enabled}'

# 2. CODEOWNERS resolves to real teams (no "Unknown owner" warnings)
#    GitHub UI: open .github/CODEOWNERS → owners show as valid links, not flagged.

# 3. Negative test: open a trivial PR from the agent identity and confirm the
#    "Merge" path is blocked pending a human Code Owner approval.
```

---

## Mapping to governance records

| Step | Record | Closes |
|---|---|---|
| 1, 3 | HG-0001 | human four-eyes on merge; no agent self-merge |
| 1, 3 | HG-0002 | immutable control plane — control-plane paths need `control-plane-owners` |
| 4 | HG-0004 | least-privilege agent identity (no human admin PAT, no merge/bypass) |
| Step 3 prod note | HG-0005 | production behind a separate human environment gate |

**Scope note.** These are GitHub org/repo **settings and identity** changes performed by a
human admin. They are intentionally outside the agent's write scope — an agent that could run
them could also relax them (HG-0002). This runbook documents them; it does not (and cannot)
self-apply them.
