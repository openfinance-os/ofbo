# ADR 0021 — Mutation testing the security-critical BFF core (HARNESS-04)

- Status: **Accepted** — chosen by the user (2026-06-24)
- Date: 2026-06-24
- Realises the HARNESS-04 follow-up parked in ADR 0019 (anti-reward-hacking).

## Context

Q1b (test-integrity) proves the build loop doesn't reach green by *weakening* a test. It can't
prove the tests *assert anything* — an over-mocked test that passes while pinning nothing is
HOLLOW-GREEN, and the assertion-count heuristic can't see it. Mutation testing is the standard
answer: inject a behaviour change (a mutant) and confirm a test fails. A surviving mutant is a
behaviour the suite doesn't actually check.

We scope it to the **security-critical BFF core** — `rbac.ts` (scope enforcement), `auth.ts`
(persona→scope minting), and the four-eyes engine (`approvals/service.ts`,
`approvals/operation-summary.ts`). These are the load-bearing controls where a hollow test is
most dangerous; mutating the whole codebase would be slow and mostly low-value.

## Decision

StrykerJS (`@stryker-mutator/vitest-runner`), configured in `stryker.config.json`, driven by a
DB-free `vitest.mutation.config.ts` (BFF unit specs only — the integration project needs a live
Postgres and must never be in the mutation loop). `coverageAnalysis: perTest` runs only the
covering tests per mutant.

**Calibrated against a real run, not guessed.** The first full run measured a **70.3% mutation
score** (rbac 78.9 / auth 69.9 / approvals 68.8) over ~390 mutants in **8m34s** at concurrency 2.
Two design consequences followed directly from that measurement — the reason this was parked until
a run existed to calibrate against:

1. **Not a universal per-PR gate.** 8.5 minutes would tax every unrelated PR. The `mutation.yml`
   workflow runs **on a weekly schedule, on demand (`workflow_dispatch`), and on PRs that touch the
   security-core paths** — i.e. exactly when the check is relevant. It blocks when it runs.
2. **`break` below the measured baseline.** `thresholds.break = 65` (baseline 70.3) — a real
   regression in the security core fails CI, but the gate doesn't flake on the mutation-score noise
   floor or on a PR that dilutes the score slightly with new code. The floor is meant to **ratchet
   upward** as the surviving mutants are killed.

The HTML/JSON report is uploaded as a CI artifact (14-day retention) so the survivor list is
visible and actionable.

## Consequences

- Hollow-green tests in the most security-sensitive code are now measurable and regression-gated.
- The measured baseline is an honest **70.3%**, not a vanity number. The surviving mutants are the
  hardening backlog (below), and the gate makes them visible + prevents backsliding.
- Reuses the existing vitest suite — no new test framework. Adds two dev dependencies
  (`@stryker-mutator/core`, `@stryker-mutator/vitest-runner`).

## Follow-ups (the ratchet)

The 101 survivors cluster as: `StringLiteral` (audit-field text / error-message strings the tests
don't pin), `Regex` (code-format validation in `operation-summary.ts`), and — the highest-value —
`ConditionalExpression` flips in `approvals/service.ts` (four-eyes guards). Killing the
conditional/regex survivors in the four-eyes core first, then raising `break` toward the new floor,
is the intended ongoing hardening. Each increment should move `thresholds.break` up, never down.

## Alternatives considered

- **Per-PR blocking on all changes**: rejected — 8.5-min runtime makes it a tax on unrelated work,
  and a noise-floor break threshold would flake. Path-filtered + scheduled is the non-flaky shape.
- **Mutating the whole codebase**: rejected — slow and dominated by low-value targets (rendering,
  wiring). The security core is where a hollow test actually costs.
- **Setting `break` at/above the baseline to look strict**: rejected — it would fail the very first
  honest run and block all security-core PRs. A floor that ratchets is the truthful design.
