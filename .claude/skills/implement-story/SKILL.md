---
name: implement-story
description: Use when implementing a numbered BACKOFFICE requirement from the PRD — one story per session, one branch, spec-first (e.g. /implement-story BACKOFFICE-17)
disable-model-invocation: true
---

# Implement a BACKOFFICE story

Story: $ARGUMENTS

CLAUDE.md rules are binding throughout; the OpenAPI contract is ground truth. Follow this order exactly.

1. **Read the canon first.** The requirement row + acceptance criteria in `docs/PRD_Open_Finance_Back_Office.md` §7, every matching path in `specs/backoffice-openapi.yaml`, and the port interfaces the story touches. If the spec conflicts with the PRD or a binding CLAUDE.md convention → **STOP** and run the `spec-change` skill before any code.
2. **Confirm scope.** Post a short plan: files to touch, endpoints, ports, and what is explicitly out of scope (name the neighbouring story IDs you are NOT building). Surface any genuine decision for the user; otherwise proceed.
3. **Branch:** `feature/BACKOFFICE-NN-<short-slug>` off `main`.
4. **Failing tests first — show them red.** Contract + acceptance tests from the OpenAPI paths and acceptance criteria, written against the **port interface** (so they later bind the enterprise adapter, M6 gate). Minimum cases:
   - `{data, meta}` envelope and `{error: …}` envelope shapes; cursor pagination if listing
   - scope enforcement at **both** layers (BFF middleware AND service); wrong-persona scope rejected
   - `Idempotency-Key` replay returns the original result, no duplicate side effects
   - exactly one `audit_high_sensitivity` INSERT for audit-relevant ops — PII-redacted, trace id propagated; verify INSERT-only by asserting UPDATE/DELETE fail
   - four-eyes endpoints (`x-four-eyes`) return `202` + `approval_request`, never execute inline; initiator ≠ approver
   - the failure path via the Nebras simulator's fault-injection endpoint
   Run the suite and show the user the red list as the checkpoint before implementing.
5. **Implement to green.** Code against port interfaces, never adapters directly; core code never branches on `DEPLOY_PROFILE`. Synthetic data only — no PII in fixtures, test names, or logs.
6. **Definition of Done — verify with evidence before claiming done:**
   - full suite green; coverage ≥80% on changed packages
   - integration tests against the real local Postgres (RLS actually exercised)
   - lineage emission (Q4.5) in the same change — never retrofit
   - grep the diff for PII-shaped literals, browser-storage writes, and any Nebras call not going through the P6 port
   - demo walkthrough for the story runs end-to-end (seeded data; fault injection where relevant)
7. **Commit + PR.** Every commit and the PR cite `BACKOFFICE-NN`. After merge, confirm the story is demonstrable at the demo URL before reporting done.

## Red flags — stop and restart the step
- Tests written after implementation, or never shown failing
- "Audit/lineage after the demo"
- Spec edited on the feature branch (use `spec-change`)
- Scope check in only one layer
- A second story ID creeping into the diff
