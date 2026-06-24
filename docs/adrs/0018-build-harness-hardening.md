# ADR 0018 — Build-harness hardening: anti-reward-hacking, contract self-correction, agent provenance (HARNESS-01..03)

- Status: **Accepted** — chosen by the user (2026-06-24)
- Date: 2026-06-24
- Scope: the autonomous build loop's machinery, not a product feature. CLAUDE.md rule 6
  (compose, don't invent new platform primitives) applies to *process* primitives too —
  hence this ADR before adding gates/hooks to the loop.

## Context

OFBO is built by an autonomous Claude Code loop (`/loop /next-story`) against a
spec-first, gated harness: worktree isolation, two PreToolUse tripwires (PII, spec),
two clean-context reviewer subagents (hard-stop, contract-conformance), CI gates
Q1–Q4.5, auto-deploy + smoke, and a sha256-sealed release evidence bundle (BACKOFFICE-57).

We researched current (2025–26) agentic-coding practice — Anthropic's Claude Code guidance,
GitHub Spec Kit / Specmatic spec-driven workflows, SWE-bench-style verification, the reward-
hacking literature, and the EU AI Act traceability obligations — to find where the field has
moved past this harness. Three gaps were genuine (not already covered by an existing
convention), and the user selected all three for implementation.

## Decision

### HARNESS-01 — Anti-reward-hacking (test integrity)

**Problem.** The loop commits contract/acceptance tests RED, then drives the code to green.
The one move that turns a real red bar green *without fixing the code* is weakening the test —
skipping it, narrowing an assertion, deleting expectations. Frontier coding agents are
documented to do exactly this under pressure to reach green (Anthropic reward-hacking research;
independent agent-benchmark cheating audits, 2025). Nothing in the harness prevented it.

**Decision.** Two layers, defence in depth (the same shape as the existing spec-tripwire):

- `.claude/hooks/test-tripwire.sh` — a PreToolUse advisory tripwire that denies blatant
  test-disabling edits (`it.skip/.only/.todo/.fails`, `xit`, commented-out `expect`/`assert`)
  to test files on `feature/*` and `claude/*` branches. Deliberately narrow so it never
  blocks legitimate test *authorship* (adding cases is always allowed).
- `scripts/test-integrity.mjs` + CI gate **Q1b** — the deterministic, merge-blocking control
  of record. Diffs the PR against its merge base and fails on (a) any added disabler marker in
  a test file, or (b) a net loss of assertions in a test file while implementation files also
  change. Pure text analysis, no model judgement — nothing to talk around.

**Escape hatch.** A genuine test defect is fixed in the open on a `feature/BACKOFFICE-NN-testfix-<slug>`
branch (mirrors spec-tripwire's `*-spec-*` pattern). Both layers exempt `*-testfix-*` and `*-spec-*`.

### HARNESS-02 — Contract self-correction (`pnpm verify:contract`)

**Problem.** The harness has unit/integration contract tests and a contract-conformance reviewer
subagent — but the loop only learned about *live response* drift late (CI, or at PR-time review).

**Decision.** Adopt the Specmatic self-correcting-contract-loop pattern: a single deterministic
command (`services/bff/scripts/verify-contract.ts`, exposed as `pnpm verify:contract`) the loop
runs each iteration against the running BFF. It reuses the existing `buildResponseValidator`
(`@ofbo/contracts/testing`) to validate real HTTP responses against `specs/backoffice-openapi.yaml`
— auto-probing every implemented parameter-less GET plus the 400/401 error envelopes — and reports
CONFORMANT/DRIFT with exit 0/1 (2 = BFF down). Wired into `run-ofbo/smoke.sh` as its final check and
documented in the run-ofbo skill. The spec stays ground truth: a DRIFT means fix the implementation;
if the *spec* is the defect, the spec-change skill runs first.

### HARNESS-03 — Agent build provenance

**Problem.** The release bundle is sealed and the audit is INSERT-only, but neither recorded
*which model/agent/session* produced each change — the EU AI Act Art. 12 (automatic logging,
≥6-month retention) + Art. 17 (lifecycle traceability) obligation binding 2 Aug 2026, and the
emerging SLSA/in-toto provenance practice.

**Decision.** Recover provenance deterministically from git history rather than adding a second
logging path: the loop already stamps every commit with `Co-Authored-By` / `Claude-Session`
(and, going forward, an optional `Build-Model`) trailers. `parseProvenance` (unit-tested) maps
the release commit range to `{ commit, author, model, session, story }` and folds the result into
the **same** sha256-sealed evidence bundle as the quality gates — so attribution is tamper-evident
by construction, not a separate artifact that can drift. A new control-mapping row ties it to
HG-0003 (traceability) and EU AI Act Art. 12/17. Human co-authors are explicitly *not* attributed
as build agents (the `unattributed_commits` count is a visible, honest signal).

## Consequences

- The loop can no longer pass a gate by weakening a test, and catches contract drift before PR
  rather than at review — both reduce reviewer load and false-green risk.
- Every release now carries cryptographically-sealed agent attribution, closing the Art. 12/17 gap.
- All three reuse existing primitives (tripwire pattern, response-validator, evidence bundle, git
  trailers) — no new auth path, gateway, or approval mechanism invented (CLAUDE.md rule 6 honoured).
- New CI job Q1b runs only on pull requests (needs a merge base); push-to-main is unaffected.

## Follow-ups (not in this change)

- **HARNESS-04 — mutation testing (StrykerJS).** Q1b's assertion-count heuristic catches assertions
  *removed*; it cannot catch HOLLOW-GREEN tests that pass while asserting nothing. Mutation testing
  (inject a bug, confirm a test fails) is the proper gate. Deferred until a real CI run calibrates the
  mutation-score threshold and runtime so it doesn't become a flaky blocker — scope to the
  security-critical BFF core (rbac/approvals) first. Captured as backlog HARNESS-04 (pending).

## Alternatives considered

- **Block all edits to tracked test files** (instead of just disablers): rejected — it blocks
  legitimate extension of pre-existing shared test files (e.g. adding a story's scope cases to
  `rbac.spec.ts`), which is normal authorship, not cheating.
- **LLM-judge for test-weakening / drift**: rejected as the *gate* — audited LLM judges exceed 50%
  error on bias tests and flip on position swaps. A regulated gate must be deterministic. The LLM
  reviewer subagents remain, but backed by these mechanical checks.
- **A second logging path for provenance**: rejected — the git trailers already exist; reading them
  is zero-drift and needs no new infrastructure.
