# HG-0005 — Environment promotion + human prod gate + rollback

- Status: **Proposed** — awaiting bank change/release-governance decision
- Date: 2026-06-20
- Scope: harness / AI-SDLC governance
- Related: HG-0001 (human approval), HG-0004 (no standing prod rights), M1-DEMO-DEPLOY, deploy.yml; the harness bank-readiness review (2026-06-20)

## Context

`deploy.yml` **auto-deploys to the single demo environment on every merge to main**
(BFF + portal + sim), then runs a post-deploy smoke suite. There is **one environment, no
promotion path, no human release gate, and no rollback/DR**. For a demo this is ideal;
for a bank it is not a production release process — production change requires staged
promotion, a human/CAB release approval, change windows, and a tested rollback.

## Requirements & regulatory basis

- **Environment segregation.** dev → test → staging → prod, with prod isolated; the agent
  must **never deploy to prod directly** (HG-0004).
- **Release approval.** A human (release manager / CAB) approves the prod promotion, in a
  change window where applicable.
- **Resilience.** Tested **rollback / DR**, and progressive delivery (canary / blue-green)
  to bound blast radius.
- **Data residency.** Prod stays in approved UAE regions (already an IaC invariant).

## Options

1. **Promotion pipeline with a human prod gate + rollback (recommended).**
   - Merge → auto-deploy to **staging** (smoke-gated, as today) — fully autonomous.
   - **Prod is a separate, human-approved environment** (GitHub Environments protection
     rule / change ticket from HG-0003); promotion runs the same artifact, never a rebuild.
   - **Canary/blue-green** for prod + a one-command **rollback**; DR runbook.
   - **Pros:** autonomy where it's safe (staging), human control where it matters (prod);
     uses native environment protections outside the agent's reach. **Cons:** prod no
     longer continuous — by design.
2. **Add a manual approval step but keep one environment.** Lighter; no real segregation
   or rollback. **Cons:** no staging isolation; risky.
3. **Status quo (auto-deploy demo).** Fine *as a demo*; **not a production release
   process** — out of scope for bank prod.

## Recommendation

**Option 1** — autonomous staging + human-gated prod promotion of the same artifact, with
canary + rollback. The current demo auto-deploy becomes the *staging* tier.

## Decision

_Pending._ Once accepted: split deploy into staging (auto) + prod (human-approved
GitHub Environment), promote the built artifact (no rebuild), add canary + rollback +
a DR runbook; the agent's identity (HG-0004) has no prod-deploy right.

## Consequences

- Staging keeps the fast feedback loop; prod gains a human release gate + rollback.
- Depends on HG-0001/HG-0003/HG-0004 (approval, change record, scoped identity).
- Requires real prod IaC (today Terraform is a region-validated skeleton) — an M6-class effort.
