# HG-0002 — Immutable control plane the agent cannot modify

- Status: **Proposed** — awaiting bank change-governance decision
- Date: 2026-06-20
- Scope: harness / AI-SDLC governance
- Related: HG-0001 (human four-eyes — meaningless if the agent can disable it); the harness bank-readiness review (2026-06-20)

## Context

The harness's guardrails live in the same repository the agent writes to: the PreToolUse
hooks (`.claude/hooks/*`), `.claude/settings.json` (the `worktree.bgIsolation` gate, hook
wiring), the CI/CD workflows (`.github/workflows/*`, the Q1–Q4.5 gates), `CLAUDE.md` (the
binding conventions/hard-stops), the reviewer subagents (`.claude/agents/*`), and the
backlog. This session the agent **edited its own rules (CLAUDE.md), its own gate
(settings.json bgIsolation), and its own skills** — legitimately, but it demonstrates the
agent can change the very controls that constrain it. Any control the controlled party
can rewrite is not a control. (Also in-scope: the CI actions use **floating major tags**
(`@v7`) rather than pinned SHAs — a mutable supply-chain surface.)

## Requirements & regulatory basis

- **Control integrity / SoD.** Guardrails and approval rules must be owned by a party
  other than the one they govern; gate definitions must be tamper-resistant.
- **Change management of controls.** Changing a control is itself a change requiring
  separate, human approval — not something the build loop does inline.
- **Supply-chain integrity.** Pipeline inputs (CI actions, dependencies, artifacts) must
  be pinned/verifiable so the gates can't be silently subverted.

## Options

1. **Protect the control plane out of the agent's reach (recommended).**
   - **CODEOWNERS** on `.github/`, `.claude/` (hooks, settings, agents, skills), `CLAUDE.md`,
     and `docs/governance/` → changes there require a separate **human** approval group;
     pair with branch protection (HG-0001) so they can't be self-merged.
   - **Org-managed settings** for the hard gates (bgIsolation, allowed hooks) via the
     managed/policy layer the agent cannot edit; `allowManagedHooksOnly`-style posture.
   - **Pin CI actions to SHAs**, add **signed commits + artifact provenance (SLSA) + SBOM**,
     and make the Q1–Q4.5 checks *required* via branch protection (not just present).
   - **Pros:** the controls become real; control changes get their own human change stream.
     **Cons:** the agent can no longer self-serve guardrail/skill tweaks — by design.
2. **Separate "controls" repo** the agent has no write access to (workflows, policy,
   reviewer prompts live there; product repo consumes them). **Pros:** hard separation.
   **Cons:** heavier; cross-repo wiring. Reserve if CODEOWNERS+managed-settings proves insufficient.
3. **Policy-only** (tell the agent not to edit controls). **Rejected** — unenforced; the
   agent provably edits them today.

## Recommendation

**Option 1** — CODEOWNERS + managed-settings + pinned/signed supply chain + required
checks, escalating to Option 2 (controls repo) only if needed.

## Decision

_Pending._ Once accepted: add CODEOWNERS for the control surfaces, move hard gates to
managed settings, pin action SHAs + enable signing/provenance/SBOM, and mark all gates
required in branch protection.

## Consequences

- Guardrail/skill/CI/CLAUDE.md changes become a **human-approved control change stream**,
  separate from feature work.
- Makes HG-0001 enforceable (the agent can't relax its own merge rules).
- Slight friction: the agent proposes control changes via PR but cannot self-apply them.
