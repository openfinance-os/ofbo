---
name: spec-change
description: Use when specs/backoffice-openapi.yaml is wrong, conflicts with CLAUDE.md binding conventions or the PRD, or when implementation/contract tests disagree with the contract mid-story
---

# Spec change — contract-first

The OpenAPI contract is ground truth, but when it violates a binding convention (CLAUDE.md) or the PRD, the **spec itself is the defect**. The order is binding: **spec PR → tests → code.** Never adapt tests or code to a wrong spec; never bury a spec edit inside a feature diff.

1. **Stop feature work.** WIP-commit the feature branch (cite the story ID) so nothing is lost.
2. **Tell the user now:** what conflicts, why the spec is the wrong side (cite the convention or PRD line), and the expected bounded delay.
3. **Cut a spec-only branch off `main`:** `feature/BACKOFFICE-NN-spec-<slug>`.
4. **Make the minimal spec edit.** Prefer shared components over inline fixes (e.g. one reusable `Money` schema: `{amount: integer minor units, currency: ISO 4217}`). Fix only what the current story touches; note same-class defects elsewhere in the PR description for their owning story — do not scope-creep.
5. **Open the spec-only PR** citing the binding rule it enforces. Humans approve contract changes — never self-merge, even under time pressure. If the gap is genuinely uncovered by the canon (a new primitive, not a defect), raise an ADR in `docs/adrs/` instead and stop.
6. **After the spec PR merges:** rebase the feature branch, regenerate the OpenAPI client, update the contract tests to the corrected shape **first**, then reconcile the implementation. Full suite to green.
7. **The feature PR links the merged spec PR** as its prerequisite.

## Red flags — you are rationalizing
- Widening the implementation to accept both shapes "for compatibility"
- "Temporarily" pointing tests at the broken spec to get green
- Folding the spec edit into the feature PR "to ship in one shot"
- Fixing every same-class defect across the spec in one PR (scope creep — note them instead)
