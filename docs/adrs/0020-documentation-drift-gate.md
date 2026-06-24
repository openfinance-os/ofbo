# ADR 0020 — Documentation-drift gate: deterministic doc→file reference + ADR-number check (HARNESS-05)

- Status: **Accepted** — chosen by the user (2026-06-24)
- Date: 2026-06-24
- Scope: build-harness machinery, not a product feature (CLAUDE.md rule 6 — process primitives get an ADR).
- Companion to ADR 0019 (HARNESS-01..03); this is the HARNESS-05 follow-up.

## Context

The harness keeps *code* honest to the OpenAPI contract (the `pnpm gen` diff-check, the
contract-conformance reviewer, and the HARNESS-02 `verify:contract` tool). But the **prose**
layer — CLAUDE.md, the PRD, ADRs, governance docs, the run-ofbo skill, and the
`control-mappings.ts` evidence registry — had no drift guard. These docs duplicate facts that
live in code (file paths in evidence rows, skill instructions, ADR cross-references), and rot
silently when the code moves.

This was not hypothetical. While ADR 0019 (#250) was in flight, ADR 0018 was taken on `main`
by a different PR (#252); both branches numbered their ADR 0018 — a collision git cannot see,
because the filenames differ. A human caught it. A deterministic check should have.

## Decision

Add `scripts/doc-link-check.mjs` and CI gate **Q2b** (`pnpm docs:check`), the doc analogue of
Q1's generated-artifact diff-check. Two deterministic checks, no model judgement:

1. **Broken file references.** Every repo-relative path mentioned in a current-state doc must
   exist. Anchored to unambiguous repo-root dirs (`packages|services|apps|docs|specs|infra|.claude|.github`)
   with a known file extension and a trailing boundary, so prose slashes ("and/or") and
   cwd-relative command examples (`scripts/serve.ts` after a `cd`) don't false-positive.
2. **Duplicate ADR numbers.** Two ADRs sharing an `NNNN` prefix fail the gate — exactly the
   0018 clash above.

**Scope deliberately excludes `docs/build-log.md`** (an append-only historical journal that
legitimately cites files which existed at the time of an entry and were later moved/removed —
enforcing live existence there would punish accurate history). Also added: a Definition-of-Done
line in the `implement-story` skill so a file move updates its cited docs in the same change.

The LLM reviewers remain useful for *semantic* staleness ("this paragraph describes old
behaviour"); but — consistent with ADR 0019's anti-reward-hacking logic — the **gate** is
deterministic, not an LLM judge.

## Consequences

- A renamed/removed file referenced by a current-state doc now fails CI, not review.
- Duplicate ADR numbers are caught mechanically (the gate dogfoods the lesson that motivated it).
- Reuses existing primitives (a CI job + a pure Node script + git) — no new platform machinery.
- Coverage limit (logged, not hidden): root-level `scripts/` and `tests/` references are not
  checked (too generic — they collide with cwd-relative command examples). High-value
  `packages/`/`services/`/`apps/`/`docs/`/`.claude/` references are.

## Follow-ups (not in this change)

- **Touch-coupling tripwire** (advisory): when `SCOPE_MATRIX` or `IMPLEMENTED_ROUTES` changes,
  flag the docs that mirror them (PRD §2 matrix, run-ofbo skill) for review — the
  `spec-tripwire`/`test-tripwire` pattern applied to doc-mirrors. Deferred; lower leverage than
  the deterministic reference gate.
