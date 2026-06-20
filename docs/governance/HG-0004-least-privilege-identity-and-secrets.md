# HG-0004 — Least-privilege agent identity + vaulted secrets

- Status: **Proposed** — awaiting bank security/IAM decision
- Date: 2026-06-20
- Scope: harness / AI-SDLC governance
- Related: HG-0001 (attributable approver), HG-0005 (no standing prod rights); the harness bank-readiness review (2026-06-20)

## Context

The build loop runs with **broad, standing credentials**: full `git`/`gh` (merge,
branch-delete, repo-admin-ish) and deploy reach (Cloudflare/Railway/Supabase). Secrets
sit in a local **`.env` on disk** and in GitHub Actions secrets. This session a
**regulated repo was made public to dodge a GitHub Actions billing block** — an expedient
posture change an autonomous actor should never be able to make unilaterally. There is no
distinct, least-privilege machine identity for "the agent," so its actions aren't cleanly
attributable or scoped.

## Requirements & regulatory basis

- **Least privilege.** The agent gets only the rights its current task needs; **no
  standing production-deploy or repo-admin rights**.
- **Secrets management.** Credentials in a **vault** with short-lived, scoped tokens —
  not `.env` files or broad CI secrets; never world-readable.
- **Attribution.** Agent actions run under a **named non-human service identity**, distinct
  from any human, so audit can answer "which agent/run did this."
- **Posture-change control.** Security-posture changes (repo visibility, permission
  grants) are human-approved changes, not agent-expedient ones.

## Options

1. **Scoped service identity + vault + policy guardrails (recommended).**
   - A dedicated **machine identity** for the agent with least-privilege, role-scoped
     tokens (propose/PR rights; **no merge, no prod deploy, no repo-admin** — those are
     HG-0001/HG-0005 human gates).
   - Secrets in a **vault** (short-lived, scoped); remove `.env`; CI pulls via OIDC, not
     long-lived secrets.
   - **Policy/permission deny-rules** (harness settings + org policy) forbidding
     repo-visibility changes, force-push, branch-protection edits, and admin ops.
   - **Pros:** scoped, attributable, vaulted; the public-repo class of incident becomes
     impossible for the agent to do alone. **Cons:** IAM + vault setup; some flows now
     require a human (intended).
2. **Keep current creds, add monitoring/alerts** on sensitive ops. Detect-not-prevent.
   **Cons:** standing broad rights remain; preventive controls preferred.
3. **Status quo.** Rejected — broad standing creds + `.env` + unilateral posture changes
   are not bank-acceptable.

## Recommendation

**Option 1** — least-privilege machine identity, vaulted short-lived secrets, OIDC for
CI, and deny-rules on posture/admin operations.

## Decision

_Pending._ Once accepted: provision the agent service identity with minimal scopes,
migrate secrets to the vault + CI OIDC, delete `.env`, and add the posture/admin deny-rules.

## Consequences

- The agent can propose and open PRs but cannot merge, deploy to prod, change repo
  visibility, or alter protections — those become human/identity-gated.
- Removes secrets-on-disk and the unilateral-posture-change risk.
- Pairs with HG-0001/HG-0002/HG-0005 (the human/control gates the scoping defers to).
